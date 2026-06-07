// @ts-check
/**
 * LUMORA HTTP API (zero-dependency, Node built-in http).
 *
 * Responsibilities:
 *  - Expose the game-core systems over a small REST surface.
 *  - Stay a thin orchestration layer: validate input → call /core pure functions →
 *    persist via the store → project a client-friendly response. No game rules live here.
 *  - Serve the static web prototype (/web) and the shared /core ES modules so the
 *    browser runs the EXACT same genome code as the server (one source of truth).
 *
 * Production note: this same routing maps cleanly onto Fastify + a Postgres-backed
 * store; the handlers would be unchanged. Auth is stubbed (player id in the path)
 * for the slice; real auth = signed session tokens (see docs/11-TECH-ARCHITECTURE.md).
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MemoryStore } from './store.js';
import { purchase, grant, debit, EconomyError } from '../core/economy.js';
import { byId, BIOMES, PLANTS, DECOR, BLOOM_PASS, IAP_PRODUCTS, productById } from '../core/content.js';
import * as garden from '../core/garden.js';
import { generateLumi, breedLumi, decodeSeedCode } from '../core/genome.js';
import {
  applyXp, levelFromXp, claimDaily, dailyQuests, dayIndex,
} from '../core/progression.js';
import { pityFloor, recordHatch } from '../core/luck.js';
import { bloomdex, claimableMilestones } from '../core/bloomdex.js';
import {
  passView, addPassXp, claimableTiers, claimTier, upgradeToPremium,
} from '../core/pass.js';
import { executeTrade, validateTrade } from '../core/trade.js';
import { extend as extendSub, claimStipend, subscriptionView } from '../core/subscription.js';
import { createAuth, bearerToken } from './auth.js';
import { createIapVerifier, verifyStripeSignature } from './iap.js';
import { createRateLimiter } from './ratelimit.js';
import { randomUUID } from 'node:crypto';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/** A typed HTTP error handlers can throw. */
class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Build the request handler around a store instance (injectable for tests).
 * @param {MemoryStore} store
 * @param {{requireAuth?: boolean, secret?: string}} [opts]
 *   requireAuth — enforce Bearer-token auth on per-account routes (on in production).
 *   secret — HMAC signing key (else JWT_SIGNING_KEY env, else a random per-process key).
 */
export function createApp(store = new MemoryStore(), opts = {}) {
  const auth = createAuth(opts.secret || process.env.JWT_SIGNING_KEY);
  const requireAuth = !!opts.requireAuth;
  const iap = createIapVerifier({
    testSecret: opts.iapTestSecret || process.env.IAP_TEST_SECRET,
    transport: opts.iapTransport, // real Apple/Google verification transport (prod); fake in tests
  });
  const stripeWebhookSecret = opts.stripeWebhookSecret || process.env.STRIPE_WEBHOOK_SECRET || null;
  const rt = opts.realtime || null; // optional real-time hub (no-op if absent)

  // Optional rate limiting (off by default). A global per-IP bucket + a stricter one
  // for sensitive endpoints (auth/account creation/purchases).
  const limiter = opts.rateLimit ? createRateLimiter(opts.rateLimit) : null;
  const sensitiveLimiter = opts.rateLimit
    ? createRateLimiter({ windowMs: opts.rateLimit.windowMs || 60_000, max: opts.rateLimit.sensitiveMax || Math.max(5, Math.floor((opts.rateLimit.max || 300) / 10)) })
    : null;
  const SENSITIVE = [/^\/api\/auth\/guest\/?$/, /^\/api\/players\/?$/, /^\/api\/players\/[^/]+\/iap\/redeem\/?$/];
  const trustProxy = !!opts.trustProxy; // only then is X-Forwarded-For trusted for IP keying

  /** @type {Array<{method:string, re:RegExp, fn:Function, requiresSelf:boolean}>} */
  const routes = [];
  const route = (method, pattern, fn) => {
    // Convert "/api/players/:id/garden" → regex with named groups.
    const re = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => `(?<${m.slice(1)}>[^/]+)`) + '/?$');
    // Any route carrying a player :id is per-account and requires the caller's token
    // subject to equal that id (you can only act on your own account).
    routes.push({ method, re, fn, requiresSelf: pattern.includes(':id') });
  };

  /**
   * Shared post-hatch effects for both harvesting and breeding: pity bookkeeping,
   * Keeper XP + feature unlocks, Bloom Pass XP, and constellation contribution.
   * Centralised so the two creation paths can never drift apart.
   */
  async function onHatch(player, lumi, xpGain) {
    recordHatch(player.pity, lumi.rarity);
    const xp = applyXp(player.xp, xpGain);
    player.xp = xp.totalXp;
    for (const u of xp.unlocked) if (u.feature in player.unlocks) player.unlocks[u.feature] = true;
    const passRes = addPassXp(player.pass, xpGain);
    await store.contributeBloom(player, 1 + rarityRank(lumi.rarity));
    // Live Great-Bloom tick to all connected clients (the shared-world meta moving).
    if (rt) rt.broadcastWorld({ bloomLevel: store.world.bloomLevel, totalLumiHatched: store.world.totalLumiHatched });
    return { unlocked: xp.unlocked, pass: passView(player.pass), tiersGained: passRes.tiersGained };
  }

  /** Apply a purchased product to a player (shared by the redeem route + Stripe webhook). */
  function grantProduct(player, product) {
    if (product.kind === 'lumen') {
      return grant(player.wallet, { lumen: product.lumen }, `iap:${product.id}`, player.ledger).lumen;
    }
    if (product.kind === 'subscription') {
      extendSub(player.subscription, product.tier, product.durationDays, Date.now());
    }
    return 0;
  }

  /**
   * Stripe webhook: verify the signature over the RAW body, then idempotently grant
   * (dedupe by Stripe event id). Stripe authenticates itself via the signature, so
   * this route takes no Bearer token. Always 2xx for accepted-but-ignored events so
   * Stripe doesn't retry forever.
   */
  async function handleStripeWebhook(req, res) {
    let raw;
    try {
      raw = await readRawBody(req);
      verifyStripeSignature(raw, req.headers['stripe-signature'], stripeWebhookSecret);
    } catch (e) {
      return sendError(res, e);
    }
    let event;
    try { event = JSON.parse(raw); } catch { return sendError(res, new HttpError(400, 'BAD_JSON', 'Body is not JSON')); }
    try {
      const result = await store.withRequest('POST', () => processStripeEvent(event));
      return sendJson(res, 200, result);
    } catch (e) {
      return sendError(res, e);
    }
  }

  async function processStripeEvent(event) {
    const HANDLED = ['checkout.session.completed', 'payment_intent.succeeded'];
    if (!event || !HANDLED.includes(event.type)) return { received: true, ignored: event && event.type };
    const obj = (event.data && event.data.object) || {};
    const md = obj.metadata || {};
    const product = productById(md.productId);
    if (!md.playerId || !product) return { received: true, ignored: 'missing/invalid metadata' };
    // Dedupe by the underlying PAYMENT, not the event id: one Checkout purchase emits
    // BOTH checkout.session.completed AND payment_intent.succeeded — keying on the
    // PaymentIntent id makes them collapse to a single grant.
    const paymentKey = event.type === 'checkout.session.completed' ? (obj.payment_intent || obj.id) : obj.id;
    if (!paymentKey) return { received: true, ignored: 'no payment id' };
    let player;
    try {
      player = await store.getPlayer(md.playerId);
    } catch {
      return { received: true, ignored: 'unknown player' }; // 200 so Stripe stops retrying
    }
    // Atomic claim → idempotent across replays AND the two event types for one purchase.
    const intendedLumen = product.kind === 'lumen' ? product.lumen : 0;
    const claimed = await store.claimReceipt({ transactionId: paymentKey, platform: 'stripe', productId: product.id, playerId: player.id, priceUsdCents: product.usdCents, grantedLumen: intendedLumen });
    if (!claimed) return { received: true, duplicate: true };
    grantProduct(player, product);
    return { received: true, granted: product.id, playerId: player.id };
  }

  /* ----------------------------- public / meta ----------------------------- */

  route('GET', '/api/healthz', () => ({ ok: true, t: Date.now() }));

  route('GET', '/api/world', () => ({ world: store.getWorld(), season: store.world.season }));

  // Catalog so a client can render the shop without hardcoding content.
  route('GET', '/api/catalog', () => ({
    biomes: BIOMES, plants: PLANTS, decor: DECOR, bloomPass: BLOOM_PASS,
  }));

  // Real-money product catalog (prices + contents), for the store UI.
  route('GET', '/api/store/products', () => ({ products: Object.values(IAP_PRODUCTS) }));

  // Account-free Lumi preview: powers "try the generator" marketing & onboarding.
  route('GET', '/api/preview/lumi', (_p, _b, q) => {
    let seed = q.get('seed');
    if (seed && /^LUMI-/i.test(seed)) {
      try {
        seed = decodeSeedCode(seed);
      } catch {
        throw new HttpError(400, 'BAD_SEED_CODE', 'Malformed seed code');
      }
    }
    const ctx = {
      biome: q.get('biome') || undefined,
      season: q.get('season') || store.world.season,
      // Sanitise numeric query params: a NaN must not poison the rarity roll.
      bloomLevel: clampNum(q.get('bloom'), 0, 100, store.world.bloomLevel),
      careQuality: clampNum(q.get('care'), 0, 1, 0.6),
    };
    const useSeed = seed != null ? seed : (Math.random() * 4294967296) >>> 0;
    return { lumi: generateLumi(useSeed, ctx) };
  });

  /* ------------------------------- players --------------------------------- */

  route('POST', '/api/players', async (_p, body) => {
    const handle = String(body.handle || '').trim();
    if (handle.length < 3 || handle.length > 20 || !/^[\w]+$/.test(handle)) {
      throw new HttpError(400, 'BAD_HANDLE', 'Handle must be 3-20 word characters');
    }
    const player = await store.createPlayer(handle);
    // Issue a session token so the creator can immediately act as this player.
    return { player: publicPlayer(player), token: auth.sign(player.id) };
  });

  // Anonymous/guest auth: a device gets (or recovers) its player + a fresh token.
  // Returning users pass the deviceId they stored last time to get the same account.
  route('POST', '/api/auth/guest', async (_p, body) => {
    const provider = 'device';
    const subject = (typeof body.deviceId === 'string' && /^[\w-]{8,128}$/.test(body.deviceId))
      ? body.deviceId
      : randomUUID();
    let player = await store.getPlayerByIdentity(provider, subject);
    let created = false;
    if (!player) {
      // Collision-resistant guest handle (alphanumeric, valid by our handle rules).
      const handle = ('g' + randomUUID().replace(/-/g, '')).slice(0, 18);
      player = await store.createPlayer(handle);
      await store.linkIdentity(provider, subject, player.id);
      created = true;
    }
    return { player: publicPlayer(player), token: auth.sign(player.id), deviceId: subject, created };
  });

  route('GET', '/api/players/:id', async (params) => {
    const player = await store.getPlayer(params.id);
    return { player: publicPlayer(player) };
  });

  route('GET', '/api/players/:id/collection', async (params, _b, q) => {
    const player = await store.getPlayer(params.id);
    const sort = q.get('sort') || 'recent';
    let list = player.collection.slice();
    if (sort === 'power') list.sort((a, b) => b.power - a.power);
    else if (sort === 'rarity') list.sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity));
    else list.reverse(); // recent first
    // The owner gets full genomes (incl. render spec) so the client can draw each
    // Lumi locally; neighbour showcases stay "slim" (see store.slimLumi) for privacy/size.
    return { collection: list, total: player.collection.length };
  });

  route('GET', '/api/players/:id/lumi/:uid', async (params) => {
    const player = await store.getPlayer(params.id);
    const lumi = player.collection.find((l) => l.uid === params.uid);
    if (!lumi) throw new HttpError(404, 'NOT_FOUND', 'No such Lumi');
    return { lumi };
  });

  /* ------------------------------ progression ------------------------------ */

  route('POST', '/api/players/:id/daily', async (params) => {
    const player = await store.getPlayer(params.id);
    const res = claimDaily(player.streak, Date.now());
    player.streak = res.updated;
    if (!res.alreadyClaimed) {
      grant(player.wallet, res.reward, 'daily_reward', player.ledger);
      // Bonus seeds, if any, are handled as a grant note for the slice.
    }
    return { claimed: !res.alreadyClaimed, reward: res.reward, streak: res.streak, broke: res.broke };
  });

  route('GET', '/api/players/:id/quests', async (params) => {
    const player = await store.getPlayer(params.id);
    return { quests: dailyQuests(player.id, Date.now()) };
  });

  /* --------------------------------- shop ---------------------------------- */

  route('POST', '/api/players/:id/shop/buy', async (params, body) => {
    const player = await store.getPlayer(params.id);
    const kind = body.kind;
    if (!['plant', 'decor', 'biome'].includes(kind)) {
      throw new HttpError(400, 'BAD_KIND', 'kind must be plant|decor|biome');
    }
    const def = purchase(player.wallet, kind, body.id, player.ledger);
    if (kind === 'biome') player.garden.biome = def.id; // simple single-garden slice
    if (kind === 'decor') player.garden.decor.push(def.id);
    return { bought: def.id, kind, wallet: player.wallet };
  });

  /* -------------------------------- garden --------------------------------- */

  route('GET', '/api/players/:id/garden', async (params) => {
    const player = await store.getPlayer(params.id);
    return { garden: garden.gardenView(player.garden, Date.now()) };
  });

  route('POST', '/api/players/:id/garden/plant', async (params, body) => {
    const player = await store.getPlayer(params.id);
    const plantId = body.plantId;
    const plotIndex = Number(body.plotIndex);
    const def = byId.plant(plantId);
    if (!def) throw new HttpError(400, 'UNKNOWN_PLANT', 'No such seed');
    // Validate the plot BEFORE charging so a rejected plant (bad/occupied plot)
    // never debits the player for a seed that wasn't sown.
    const plot = player.garden.plots[plotIndex];
    if (!plot) throw new HttpError(400, 'BAD_PLOT', `No plot at index ${body.plotIndex}`);
    if (plot.planting) throw new HttpError(400, 'PLOT_OCCUPIED', 'Plot is already occupied');
    // The seed IS the cost; charge now that we know the plant will succeed.
    purchase(player.wallet, 'plant', plantId, player.ledger);
    const planting = garden.plant(
      player.garden, plotIndex, plantId,
      { season: store.world.season, bloomLevel: store.world.bloomLevel }, Date.now(),
    );
    return { planted: { plotIndex, readyAt: planting.readyAt }, wallet: player.wallet };
  });

  route('POST', '/api/players/:id/garden/water', async (params, body) => {
    const player = await store.getPlayer(params.id);
    const res = garden.water(player.garden, Number(body.plotIndex), Date.now());
    return { watered: res.watered, readyAt: res.readyAt };
  });

  route('POST', '/api/players/:id/garden/harvest', async (params, body) => {
    const player = await store.getPlayer(params.id);
    // Evaluate bad-luck protection at hatch time against the player's live dry streak.
    const floor = pityFloor(player.pity);
    const { lumi } = garden.harvest(
      player.garden, Number(body.plotIndex), Date.now(), floor ? { rarityFloor: floor } : {},
    );
    const owned = store.addLumi(player, lumi);
    const fx = await onHatch(player, lumi, 40 + rarityRank(lumi.rarity) * 25);
    return {
      lumi: owned, level: levelFromXp(player.xp), unlocked: fx.unlocked,
      pass: fx.pass, pityRescue: !!floor,
    };
  });

  /* ------------------------------- breeding -------------------------------- */

  route('POST', '/api/players/:id/breed', async (params, body) => {
    const player = await store.getPlayer(params.id);
    const a = player.collection.find((l) => l.uid === body.parentA);
    const b = player.collection.find((l) => l.uid === body.parentB);
    if (!a || !b) throw new HttpError(400, 'BAD_PARENTS', 'Both parents must be owned');
    if (a.uid === b.uid) throw new HttpError(400, 'SAME_PARENT', 'Pick two different Lumi');
    // The Bloom Ritual costs Lumen (a healthy premium sink that is never mandatory).
    purchaseRitual(player);
    const ritualSeed = (Date.now() ^ (player.collection.length * 2654435761)) >>> 0;
    const child = breedLumi(a, b, { ritualSeed, biome: player.garden.biome, season: store.world.season, bloomLevel: store.world.bloomLevel });
    const owned = store.addLumi(player, child);
    const fx = await onHatch(player, child, 120);
    return { child: owned, wallet: player.wallet, level: levelFromXp(player.xp), pass: fx.pass };
  });

  /* ------------------------------- social ---------------------------------- */

  route('GET', '/api/players/:id/neighbours', async (params) => {
    const player = await store.getPlayer(params.id);
    return { neighbours: await store.listNeighbours(player.id) };
  });

  route('POST', '/api/players/:id/visit', async (params, body) => {
    const player = await store.getPlayer(params.id);
    if (!body.targetId || body.targetId === player.id) {
      throw new HttpError(400, 'BAD_VISIT', 'Pick a neighbour other than yourself');
    }
    const target = await store.getPlayer(body.targetId); // 404 if no such player
    // Live ping to the visited neighbour (if they're online), regardless of reward.
    if (rt) rt.notify(body.targetId, { type: 'visit', from: player.handle });
    const today = dayIndex(Date.now());
    if (!player.visitLog || player.visitLog.day !== today) player.visitLog = { day: today, ids: [] };
    // The reward is capped two ways so it can't be farmed: once per neighbour per UTC
    // day, AND only for the first N distinct neighbours per day (a breadth cap — the
    // per-target cap alone wouldn't stop farming across many player ids).
    if (player.visitLog.ids.includes(body.targetId)) {
      return { visited: target.handle, reward: { petals: 0 }, alreadyVisitedToday: true };
    }
    if (player.visitLog.ids.length >= VISIT_REWARD_CAP_PER_DAY) {
      return { visited: target.handle, reward: { petals: 0 }, dailyCapReached: true };
    }
    player.visitLog.ids.push(body.targetId);
    player.stats.visits += 1; // count distinct rewarded visits only
    grant(player.wallet, { petals: 25 }, 'social_visit', player.ledger);
    return { visited: target.handle, reward: { petals: 25 } };
  });

  route('GET', '/api/leaderboard', async () => ({ leaderboard: await store.leaderboard() }));

  /* ------------------------------- Bloomdex -------------------------------- */

  route('GET', '/api/players/:id/bloomdex', async (params) => {
    const player = await store.getPlayer(params.id);
    const dex = bloomdex(player.collection);
    const { milestones } = claimableMilestones(player.collection, player.bloomdexClaimed);
    return { bloomdex: dex, claimable: milestones.map((m) => ({ id: m.id, label: m.label, reward: m.reward })) };
  });

  route('POST', '/api/players/:id/bloomdex/claim', async (params) => {
    const player = await store.getPlayer(params.id);
    const { milestones, reward } = claimableMilestones(player.collection, player.bloomdexClaimed);
    if (!milestones.length) throw new HttpError(400, 'NOTHING_TO_CLAIM', 'No Bloomdex milestones ready');
    grant(player.wallet, reward, 'bloomdex_milestone', player.ledger);
    for (const m of milestones) player.bloomdexClaimed.push(m.id);
    return { claimed: milestones.map((m) => m.id), reward, wallet: player.wallet };
  });

  /* ------------------------------ Bloom Pass ------------------------------- */

  route('GET', '/api/players/:id/pass', async (params) => {
    const player = await store.getPlayer(params.id);
    return { pass: passView(player.pass), claimable: claimableTiers(player.pass) };
  });

  route('POST', '/api/players/:id/pass/claim', async (params, body) => {
    const player = await store.getPlayer(params.id);
    const lane = body.lane === 'premium' ? 'premium' : 'free';
    let reward;
    try {
      reward = claimTier(player.pass, Number(body.tier), lane);
    } catch (e) {
      throw new HttpError(400, 'PASS_CLAIM', e.message);
    }
    if (!reward) throw new HttpError(400, 'ALREADY_CLAIMED', 'Nothing to claim on that tier/lane');
    // Translate currency rewards into wallet grants; cosmetics/seeds are noted as-is.
    grant(player.wallet, { petals: reward.petals, lumen: reward.lumen }, `pass:${lane}:${body.tier}`, player.ledger);
    return { claimed: { tier: Number(body.tier), lane }, reward, wallet: player.wallet };
  });

  route('POST', '/api/players/:id/pass/upgrade', async (params) => {
    const player = await store.getPlayer(params.id);
    if (player.pass.premium) throw new HttpError(400, 'ALREADY_PREMIUM', 'Premium pass already owned');
    if (player.wallet.lumen < PASS_PREMIUM_COST) throw new HttpError(402, 'NEED_LUMEN', `Premium Bloom Pass costs ${PASS_PREMIUM_COST} Lumen`);
    debit(player.wallet, 'lumen', PASS_PREMIUM_COST, 'pass_premium', player.ledger);
    upgradeToPremium(player.pass);
    return { premium: true, wallet: player.wallet, pass: passView(player.pass) };
  });

  /* ----------------------- Monetisation: IAP & subscription ---------------- */

  // Redeem a real-money purchase. Server-verified + idempotent: a transaction id can
  // only ever grant once, so retries/replays never double-credit (money correctness).
  route('POST', '/api/players/:id/iap/redeem', async (params, body) => {
    const player = await store.getPlayer(params.id);
    const { platform, productId, transactionId, receipt } = body;
    const verified = await iap.verify(platform, productId, transactionId, receipt); // throws typed 4xx/5xx
    const now = Date.now();
    // Trust the provider-AUTHORITATIVE product/transaction, not the client's claim.
    const txId = verified.transactionId;
    const product = productById(verified.productId);
    // Atomically CLAIM before granting → no double-credit under concurrent redeems.
    const intendedLumen = product.kind === 'lumen' ? product.lumen : 0;
    const claimed = await store.claimReceipt({ transactionId: txId, platform, productId: product.id, playerId: player.id, priceUsdCents: product.usdCents, grantedLumen: intendedLumen });
    if (!claimed) {
      return { alreadyRedeemed: true, wallet: player.wallet, subscription: subscriptionView(player.subscription, now) };
    }
    const grantedLumen = grantProduct(player, product);
    return {
      redeemed: true, product: product.id, grantedLumen,
      wallet: player.wallet, subscription: subscriptionView(player.subscription, now),
    };
  });

  route('GET', '/api/players/:id/subscription', async (params) => {
    const player = await store.getPlayer(params.id);
    return { subscription: subscriptionView(player.subscription, Date.now()) };
  });

  // Claim the Golden Garden daily Lumen stipend (once per day while subscribed).
  route('POST', '/api/players/:id/subscription/stipend', async (params) => {
    const player = await store.getPlayer(params.id);
    const res = claimStipend(player.subscription, Date.now());
    if (!res.claimed) throw new HttpError(400, 'NO_STIPEND', 'No stipend available (inactive or already claimed today)');
    grant(player.wallet, { lumen: res.lumen }, 'sub_stipend', player.ledger);
    return { claimed: true, lumen: res.lumen, wallet: player.wallet };
  });

  /* ----------------------------- Constellations ---------------------------- */

  route('GET', '/api/constellations', async () => ({ constellations: await store.listConstellations() }));

  route('GET', '/api/players/:id/constellation', async (params) => {
    const player = await store.getPlayer(params.id);
    if (!player.constellationId) return { constellation: null };
    const c = await store.getConstellation(player.constellationId);
    return { constellation: c };
  });

  route('POST', '/api/players/:id/constellation/create', async (params, body) => {
    const player = await store.getPlayer(params.id);
    const c = await store.createConstellation(player, body.name);
    if (rt) rt.setRoom(player.id, c.id); // move any live socket into the new chat room
    return { constellation: { id: c.id, name: c.name, members: c.members.length, bloomScore: c.bloomScore } };
  });

  route('POST', '/api/players/:id/constellation/join', async (params, body) => {
    const player = await store.getPlayer(params.id);
    const c = await store.joinConstellation(player, body.constellationId);
    if (rt) rt.setRoom(player.id, c.id);
    return { constellation: { id: c.id, name: c.name, members: c.members.length, bloomScore: c.bloomScore } };
  });

  /* -------------------------------- Trades --------------------------------- */

  route('GET', '/api/players/:id/trades', async (params) => {
    const player = await store.getPlayer(params.id);
    return { incoming: await store.listIncomingTrades(player.id) };
  });

  route('POST', '/api/players/:id/trades', async (params, body) => {
    const from = await store.getPlayer(params.id);
    const to = await store.getPlayer(body.toId);
    // Validate the offer up-front so a player can't propose something they can't honour.
    let tax;
    try {
      tax = validateTrade(from, to, body).tax;
    } catch (e) {
      throw new HttpError(400, e.code || 'TRADE_INVALID', e.message);
    }
    const trade = store.createTrade(from, to, body);
    return { trade, tax };
  });

  route('POST', '/api/players/:id/trades/:tradeId/accept', async (params) => {
    const accepter = await store.getPlayer(params.id);
    const trade = await store.getTrade(params.tradeId);
    if (!trade || trade.status !== 'open') throw new HttpError(404, 'NO_TRADE', 'Trade not found or closed');
    if (trade.toId !== accepter.id) throw new HttpError(403, 'NOT_RECIPIENT', 'Only the recipient can accept');
    const from = await store.getPlayer(trade.fromId);
    let result;
    try {
      result = executeTrade(from, accepter, trade);
    } catch (e) {
      throw new HttpError(400, e.code || 'TRADE_FAILED', e.message);
    }
    trade.status = 'accepted';
    trade.resolvedAt = Date.now();
    return { result, fromWallet: from.wallet, toWallet: accepter.wallet };
  });

  route('POST', '/api/players/:id/trades/:tradeId/cancel', async (params) => {
    const player = await store.getPlayer(params.id);
    const trade = await store.getTrade(params.tradeId);
    if (!trade || trade.status !== 'open') throw new HttpError(404, 'NO_TRADE', 'Trade not found or closed');
    if (trade.fromId !== player.id && trade.toId !== player.id) throw new HttpError(403, 'NOT_PARTY', 'Not your trade');
    trade.status = 'cancelled';
    return { cancelled: trade.id };
  });

  /* -------------------------- Lumi management ------------------------------ */

  route('POST', '/api/players/:id/lumi/:uid/lock', async (params, body) => {
    const player = await store.getPlayer(params.id);
    const lumi = player.collection.find((l) => l.uid === params.uid);
    if (!lumi) throw new HttpError(404, 'NOT_FOUND', 'No such Lumi');
    lumi.locked = body.locked !== false; // default to locking
    return { uid: lumi.uid, locked: lumi.locked };
  });

  /* ----------------------------- request loop ------------------------------ */

  /**
   * The Node http listener.
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  return async function handler(req, res) {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    setCors(res);
    if (req.method === 'OPTIONS') return send(res, 204, '');

    // Stripe webhook: needs the RAW body for signature verification + no Bearer token
    // (Stripe authenticates via the signature), so it bypasses JSON parsing & auth.
    if (req.method === 'POST' && url.pathname === '/api/webhooks/stripe') {
      return handleStripeWebhook(req, res);
    }

    // API routing
    if (url.pathname.startsWith('/api/')) {
      try {
        // Rate limiting (when enabled): global per-IP + a stricter bucket for sensitive routes.
        if (limiter) {
          const ip = clientIp(req, trustProxy);
          const g = limiter.hit(ip);
          const s = SENSITIVE.some((re) => re.test(url.pathname)) ? sensitiveLimiter.hit('s:' + ip) : { allowed: true, retryAfterMs: 0 };
          if (!g.allowed || !s.allowed) {
            res.setHeader('Retry-After', Math.ceil(Math.max(g.retryAfterMs, s.retryAfterMs) / 1000));
            return sendJson(res, 429, { error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
          }
        }
        const match = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
        if (!match) throw new HttpError(404, 'NO_ROUTE', `No route for ${req.method} ${url.pathname}`);
        const params = url.pathname.match(match.re)?.groups || {};
        // Per-account routes require a valid Bearer token whose subject is this id.
        if (requireAuth && match.requiresSelf) {
          const payload = auth.verify(bearerToken(req));
          if (payload.sub !== params.id) {
            throw new HttpError(403, 'FORBIDDEN', 'You can only act on your own account');
          }
        }
        const body = req.method === 'POST' ? await readJson(req) : {};
        // Run the handler inside the store's per-request unit of work. For PgStore
        // this loads/commits a transaction; for MemoryStore it just runs the handler.
        const result = await store.withRequest(req.method, () => match.fn(params, body, url.searchParams));
        return sendJson(res, 200, result);
      } catch (err) {
        return sendError(res, err);
      }
    }

    // Static file serving for the web prototype + shared /core modules.
    return serveStatic(url.pathname, res);
  };
}

/* ------------------------------ helpers ---------------------------------- */

/** Premium breeding sink; isolated so its price is easy to tune/live-ops. */
function purchaseRitual(player) {
  const cost = { lumen: 25 };
  if (player.wallet.lumen < cost.lumen) {
    throw new HttpError(402, 'NEED_LUMEN', 'The Bloom Ritual costs 25 Lumen');
  }
  player.wallet.lumen -= cost.lumen;
  player.ledger.push({ t: Date.now(), currency: 'lumen', delta: -cost.lumen, reason: 'breed_ritual', kind: 'sink' });
}

function publicPlayer(p) {
  return {
    id: p.id,
    handle: p.handle,
    wallet: p.wallet,
    level: levelFromXp(p.xp),
    xp: p.xp,
    garden: garden.gardenView(p.garden, Date.now()),
    collectionSize: p.collection.length,
    unlocks: p.unlocks,
    streak: p.streak.streak ?? 0,
    stats: p.stats,
    pass: passView(p.pass),
    constellationId: p.constellationId,
    subscription: subscriptionView(p.subscription, Date.now()),
  };
}

const RARITY_RANK = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 };
function rarityRank(r) { return RARITY_RANK[r] ?? 0; }

/** Premium Bloom Pass price in Lumen (~the 9.99€ tier; tune via remote-config in prod). */
const PASS_PREMIUM_COST = 800;

/** Max rewarded neighbour visits per UTC day (bounds the social-visit petals faucet). */
const VISIT_REWARD_CAP_PER_DAY = 5;

/** Parse a query value to a number clamped to [min,max]; falls back to `dflt` on NaN. */
function clampNum(raw, min, max, dflt) {
  if (raw == null || raw === '') return dflt;
  const n = Number(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

/** Client IP for rate-limit keying. Only trust X-Forwarded-For when explicitly behind
 *  a known proxy (opts.trustProxy) — otherwise it is attacker-controlled and would let
 *  a caller rotate the header to bypass the limiter. Default: the socket address. */
function clientIp(req, trustProxy) {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

function sendError(res, err) {
  // Typed domain errors (HttpError, EconomyError, GameError) all carry a `status`;
  // anything else is a genuine server fault → 500 (and logged for on-call).
  const status = err.status || 500;
  const code = err.code || 'INTERNAL';
  if (status >= 500) console.error('[api] 500', err);
  const message = status >= 500 ? 'Internal error' : err.message; // don't leak internals on 5xx
  sendJson(res, status, { error: { code, message } });
}

/** Max accepted request body. Guards against unbounded-body memory exhaustion. */
const MAX_BODY_BYTES = 512 * 1024;

/** Read the raw request body as a string (capped). Needed for signature verification. */
async function readRawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'BODY_TOO_LARGE', 'Request body too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'BODY_TOO_LARGE', 'Request body too large');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'BAD_JSON', 'Request body is not valid JSON');
  }
  // Bodies must be JSON objects; reject arrays/scalars so `body.field` is always safe.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'BAD_BODY', 'Request body must be a JSON object');
  }
  return parsed;
}

/** Serve files from /web (default) and /core, with path-traversal protection. */
async function serveStatic(pathname, res) {
  let rel = pathname === '/' ? '/web/index.html' : pathname;
  if (!rel.startsWith('/core/') && !rel.startsWith('/web/')) rel = '/web' + rel;
  const safe = normalize(join(ROOT, rel)).replace(/\\/g, '/');
  if (!safe.startsWith(ROOT.replace(/\\/g, '/'))) return send(res, 403, 'Forbidden');
  try {
    const info = await stat(safe);
    if (!info.isFile()) throw new Error('not a file');
    const type = MIME[extname(safe)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    createReadStream(safe).pipe(res);
  } catch {
    send(res, 404, 'Not found');
  }
}
