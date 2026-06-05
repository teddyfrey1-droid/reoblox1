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
import { purchase, grant, EconomyError } from '../core/economy.js';
import { byId, BIOMES, PLANTS, DECOR, BLOOM_PASS } from '../core/content.js';
import * as garden from '../core/garden.js';
import { generateLumi, breedLumi, decodeSeedCode } from '../core/genome.js';
import {
  applyXp, levelFromXp, claimDaily, dailyQuests,
} from '../core/progression.js';

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
 */
export function createApp(store = new MemoryStore()) {
  /** @type {Array<{method:string, re:RegExp, fn:Function}>} */
  const routes = [];
  const route = (method, pattern, fn) => {
    // Convert "/api/players/:id/garden" → regex with named groups.
    const re = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => `(?<${m.slice(1)}>[^/]+)`) + '/?$');
    routes.push({ method, re, fn });
  };

  /* ----------------------------- public / meta ----------------------------- */

  route('GET', '/api/healthz', () => ({ ok: true, t: Date.now() }));

  route('GET', '/api/world', () => ({ world: store.getWorld(), season: store.world.season }));

  // Catalog so a client can render the shop without hardcoding content.
  route('GET', '/api/catalog', () => ({
    biomes: BIOMES, plants: PLANTS, decor: DECOR, bloomPass: BLOOM_PASS,
  }));

  // Account-free Lumi preview: powers "try the generator" marketing & onboarding.
  route('GET', '/api/preview/lumi', (_p, _b, q) => {
    let seed = q.get('seed');
    if (seed && /^LUMI-/i.test(seed)) seed = decodeSeedCode(seed);
    const ctx = {
      biome: q.get('biome') || undefined,
      season: q.get('season') || store.world.season,
      bloomLevel: q.has('bloom') ? Number(q.get('bloom')) : store.world.bloomLevel,
      careQuality: q.has('care') ? Number(q.get('care')) : 0.6,
    };
    const useSeed = seed != null ? seed : (Math.random() * 4294967296) >>> 0;
    return { lumi: generateLumi(useSeed, ctx) };
  });

  /* ------------------------------- players --------------------------------- */

  route('POST', '/api/players', (_p, body) => {
    const handle = String(body.handle || '').trim();
    if (handle.length < 3 || handle.length > 20 || !/^[\w]+$/.test(handle)) {
      throw new HttpError(400, 'BAD_HANDLE', 'Handle must be 3-20 word characters');
    }
    const player = store.createPlayer(handle);
    return { player: publicPlayer(player) };
  });

  route('GET', '/api/players/:id', (params) => {
    const player = store.getPlayer(params.id);
    return { player: publicPlayer(player) };
  });

  route('GET', '/api/players/:id/collection', (params, _b, q) => {
    const player = store.getPlayer(params.id);
    const sort = q.get('sort') || 'recent';
    let list = player.collection.slice();
    if (sort === 'power') list.sort((a, b) => b.power - a.power);
    else if (sort === 'rarity') list.sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity));
    else list.reverse(); // recent first
    // The owner gets full genomes (incl. render spec) so the client can draw each
    // Lumi locally; neighbour showcases stay "slim" (see store.slimLumi) for privacy/size.
    return { collection: list, total: player.collection.length };
  });

  route('GET', '/api/players/:id/lumi/:uid', (params) => {
    const player = store.getPlayer(params.id);
    const lumi = player.collection.find((l) => l.uid === params.uid);
    if (!lumi) throw new HttpError(404, 'NOT_FOUND', 'No such Lumi');
    return { lumi };
  });

  /* ------------------------------ progression ------------------------------ */

  route('POST', '/api/players/:id/daily', (params) => {
    const player = store.getPlayer(params.id);
    const res = claimDaily(player.streak, Date.now());
    player.streak = res.updated;
    if (!res.alreadyClaimed) {
      grant(player.wallet, res.reward, 'daily_reward', player.ledger);
      // Bonus seeds, if any, are handled as a grant note for the slice.
    }
    return { claimed: !res.alreadyClaimed, reward: res.reward, streak: res.streak, broke: res.broke };
  });

  route('GET', '/api/players/:id/quests', (params) => {
    const player = store.getPlayer(params.id);
    return { quests: dailyQuests(player.id, Date.now()) };
  });

  /* --------------------------------- shop ---------------------------------- */

  route('POST', '/api/players/:id/shop/buy', (params, body) => {
    const player = store.getPlayer(params.id);
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

  route('GET', '/api/players/:id/garden', (params) => {
    const player = store.getPlayer(params.id);
    return { garden: garden.gardenView(player.garden, Date.now()) };
  });

  route('POST', '/api/players/:id/garden/plant', (params, body) => {
    const player = store.getPlayer(params.id);
    const plantId = body.plantId;
    const def = byId.plant(plantId);
    if (!def) throw new HttpError(400, 'UNKNOWN_PLANT', 'No such seed');
    // Planting consumes a seed: charge its price at plant time (the seed IS the cost).
    purchase(player.wallet, 'plant', plantId, player.ledger);
    const planting = garden.plant(
      player.garden, Number(body.plotIndex), plantId,
      { season: store.world.season, bloomLevel: store.world.bloomLevel }, Date.now(),
    );
    return { planted: { plotIndex: Number(body.plotIndex), readyAt: planting.readyAt }, wallet: player.wallet };
  });

  route('POST', '/api/players/:id/garden/water', (params, body) => {
    const player = store.getPlayer(params.id);
    const res = garden.water(player.garden, Number(body.plotIndex), Date.now());
    return { watered: res.watered, readyAt: res.readyAt };
  });

  route('POST', '/api/players/:id/garden/harvest', (params, body) => {
    const player = store.getPlayer(params.id);
    const { lumi } = garden.harvest(player.garden, Number(body.plotIndex), Date.now());
    const owned = store.addLumi(player, lumi);
    // Hatching grants XP; level-ups may unlock features.
    const xp = applyXp(player.xp, 40 + rarityRank(lumi.rarity) * 25);
    player.xp = xp.totalXp;
    for (const u of xp.unlocked) if (u.feature in player.unlocks) player.unlocks[u.feature] = true;
    return { lumi: owned, level: levelFromXp(player.xp), unlocked: xp.unlocked };
  });

  /* ------------------------------- breeding -------------------------------- */

  route('POST', '/api/players/:id/breed', (params, body) => {
    const player = store.getPlayer(params.id);
    const a = player.collection.find((l) => l.uid === body.parentA);
    const b = player.collection.find((l) => l.uid === body.parentB);
    if (!a || !b) throw new HttpError(400, 'BAD_PARENTS', 'Both parents must be owned');
    if (a.uid === b.uid) throw new HttpError(400, 'SAME_PARENT', 'Pick two different Lumi');
    // The Bloom Ritual costs Lumen (a healthy premium sink that is never mandatory).
    purchaseRitual(player);
    const ritualSeed = (Date.now() ^ (player.collection.length * 2654435761)) >>> 0;
    const child = breedLumi(a, b, { ritualSeed, biome: player.garden.biome, season: store.world.season, bloomLevel: store.world.bloomLevel });
    const owned = store.addLumi(player, child);
    const xp = applyXp(player.xp, 120);
    player.xp = xp.totalXp;
    return { child: owned, wallet: player.wallet, level: levelFromXp(player.xp) };
  });

  /* ------------------------------- social ---------------------------------- */

  route('GET', '/api/players/:id/neighbours', (params) => {
    const player = store.getPlayer(params.id);
    return { neighbours: store.listNeighbours(player.id) };
  });

  route('POST', '/api/players/:id/visit', (params, body) => {
    const player = store.getPlayer(params.id);
    const target = store.getPlayer(body.targetId);
    player.stats.visits += 1;
    // Visiting a neighbour grants a small "watering can" social reward (encourages it).
    grant(player.wallet, { petals: 25 }, 'social_visit', player.ledger);
    return { visited: target.handle, reward: { petals: 25 } };
  });

  route('GET', '/api/leaderboard', () => ({ leaderboard: store.leaderboard() }));

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

    // API routing
    if (url.pathname.startsWith('/api/')) {
      try {
        const match = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
        if (!match) throw new HttpError(404, 'NO_ROUTE', `No route for ${req.method} ${url.pathname}`);
        const params = url.pathname.match(match.re)?.groups || {};
        const body = req.method === 'POST' ? await readJson(req) : {};
        const result = await match.fn(params, body, url.searchParams);
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
  };
}

const RARITY_RANK = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 };
function rarityRank(r) { return RARITY_RANK[r] ?? 0; }

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

function sendError(res, err) {
  const status = err.status || (err instanceof EconomyError ? 400 : 500);
  const code = err.code || 'INTERNAL';
  if (status >= 500) console.error('[api] 500', err);
  sendJson(res, status, { error: { code, message: err.message } });
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'BAD_JSON', 'Request body is not valid JSON');
  }
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
