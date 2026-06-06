// @ts-check
/**
 * PostgreSQL-backed player store — the durable production implementation of the
 * same interface as MemoryStore.
 *
 * Design:
 *  - **Per-request unit of work** (via AsyncLocalStorage): within a request,
 *    `getPlayer`/`createPlayer`/`getConstellation`/`getTrade` hydrate entities into
 *    an identity map; handlers mutate those live objects exactly as they do with the
 *    in-memory store; then `commit()` (run by the API request loop after a successful
 *    POST) writes every touched entity back inside a single transaction. Reads (GET)
 *    never persist. A handler error skips commit → no partial writes.
 *  - Maps the relational schema in db/schema.sql: players + wallets + daily_streaks
 *    + gardens + lumi + economy_ledger + constellations(+members) + trades +
 *    world_state. Per-player progression detail (pity, pass, unlocks, stats,
 *    bloomdex, guild membership) lives in players.flags JSONB. The full resolved
 *    genome is persisted (bred Lumi aren't reproducible from seed alone).
 *
 * It depends only on the Db adapter (./db.js), so it is exercised against a real
 * Postgres engine (PGlite) in the test-suite and runs on managed Postgres in prod.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import { newPlayer, starterLumi, slimLumi } from './store.js';
import { ensureSchema } from './db.js';
import { createGarden } from '../core/garden.js';
import { createPity } from '../core/luck.js';
import { createPassState } from '../core/pass.js';
import { createSubscription } from '../core/subscription.js';
import { levelFromXp } from '../core/progression.js';

const num = (v) => (v == null ? 0 : Number(v));
const err = (code, status, message) => Object.assign(new Error(message), { code, status });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * A malformed id must read as "not found", never reach Postgres (where binding a
 * non-UUID to a UUID column raises a 500). This keeps PgStore's error semantics
 * identical to MemoryStore (clean 404) for garbage ids.
 */
const isUuid = (s) => typeof s === 'string' && UUID_RE.test(s);

export class PgStore {
  /** @param {import('./db.js').Db} db */
  constructor(db) {
    this.db = db;
    this.als = new AsyncLocalStorage();
    /** Hot, in-memory mirror of the shared world (flushed to world_state on commit). */
    this.world = { season: 'spring', bloomLevel: 0, totalLumiHatched: 0, startedAt: Date.now() };
  }

  /** Create tables if needed and load the shared world row. */
  async init() {
    await ensureSchema(this.db);
    await this.db.query('INSERT INTO world_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
    this.world = await this._loadWorld();
    return this;
  }

  _ctx() {
    return this.als.getStore();
  }

  /**
   * Run a request inside a unit of work; commit on a successful mutating request.
   * @param {string} method @param {() => any} fn
   */
  withRequest(method, fn) {
    return this.als.run({ players: new Map(), cons: new Map(), trades: new Map(), identities: [], receipts: [] }, async () => {
      const result = await fn();
      if (method === 'POST') await this._commit();
      return result;
    });
  }

  /* ------------------------------- players --------------------------------- */

  async createPlayer(handle) {
    const ex = await this.db.query('SELECT 1 FROM players WHERE handle = $1', [handle]);
    if (ex.rows.length) throw err('HANDLE_TAKEN', 409, 'Handle already taken');
    const player = newPlayer(randomUUID(), handle);
    const ctx = this._ctx();
    if (ctx) ctx.players.set(player.id, player);
    for (const lumi of starterLumi(handle, this.world)) this.addLumi(player, lumi);
    return player;
  }

  async getPlayer(id) {
    const ctx = this._ctx();
    if (ctx && ctx.players.has(id)) return ctx.players.get(id);
    const player = await this._loadPlayer(id);
    if (!player) throw err('NOT_FOUND', 404, 'Player not found');
    if (ctx) ctx.players.set(id, player);
    return player;
  }

  async getPlayerByHandle(handle) {
    const r = await this.db.query('SELECT id FROM players WHERE handle = $1', [handle]);
    return r.rows.length ? this.getPlayer(r.rows[0].id) : null;
  }

  /** Queue an auth identity link; persisted in commit (after the player row exists). */
  linkIdentity(provider, subject, playerId) {
    const ctx = this._ctx();
    if (ctx) ctx.identities.push({ provider, subject, playerId });
  }

  /** Resolve a provider identity to its player (or null). */
  async getPlayerByIdentity(provider, subject) {
    const r = await this.db.query(
      'SELECT player_id FROM auth_identities WHERE provider = $1 AND subject = $2',
      [provider, subject],
    );
    return r.rows.length ? this.getPlayer(r.rows[0].player_id) : null;
  }

  /** Idempotency guard: has this purchase transaction already been redeemed? */
  async hasReceipt(transactionId) {
    const r = await this.db.query('SELECT 1 FROM iap_receipts WHERE transaction_id = $1', [transactionId]);
    return r.rows.length > 0;
  }

  /** Queue a verified receipt; persisted in commit (unique transaction_id dedupes). */
  recordReceipt(receipt) {
    const ctx = this._ctx();
    if (ctx) ctx.receipts.push(receipt);
  }

  /** Mutate-only (no DB): push to collection and nudge the shared world. */
  addLumi(player, lumi) {
    const owned = { ...lumi, uid: randomUUID(), caughtAt: Date.now() };
    player.collection.push(owned);
    player.stats.lumiHatched += 1;
    this.world.totalLumiHatched += 1;
    this.world.bloomLevel = Math.min(100, this.world.bloomLevel + 0.001);
    return owned;
  }

  async listNeighbours(excludeId, limit = 12) {
    const r = await this.db.query(
      `SELECT p.id, p.handle, g.biome, g.bloom,
              (SELECT count(*) FROM lumi WHERE owner_id = p.id)::int AS csize
       FROM players p LEFT JOIN gardens g ON g.player_id = p.id
       WHERE p.id <> $1 LIMIT $2`,
      [excludeId, limit],
    );
    const out = [];
    for (const row of r.rows) {
      const sc = await this.db.query('SELECT genome FROM lumi WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 3', [row.id]);
      out.push({
        id: row.id, handle: row.handle, biome: row.biome || 'meadow', bloom: num(row.bloom),
        collectionSize: num(row.csize), showcase: sc.rows.map((x) => slimLumi(x.genome)),
      });
    }
    return out;
  }

  async leaderboard(limit = 10) {
    const r = await this.db.query(
      `SELECT p.handle, COALESCE(g.bloom, 0) AS bloom,
              (SELECT count(*) FROM lumi WHERE owner_id = p.id)::int AS csize,
              (SELECT COALESCE(max(power), 0) FROM lumi WHERE owner_id = p.id)::int AS toppower
       FROM players p LEFT JOIN gardens g ON g.player_id = p.id`,
    );
    const rows = r.rows.map((x) => ({ handle: x.handle, collectionSize: num(x.csize), topPower: num(x.toppower), bloom: num(x.bloom) }));
    rows.sort((a, b) => b.topPower - a.topPower || b.collectionSize - a.collectionSize);
    return rows.slice(0, limit);
  }

  getWorld() {
    return { ...this.world, uptimeMs: Date.now() - this.world.startedAt };
  }

  /* ----------------------------- Constellations ---------------------------- */

  async createConstellation(player, name) {
    if (player.constellationId) throw err('IN_GUILD', 409, 'Already in a constellation');
    const clean = String(name || '').trim();
    if (clean.length < 3 || clean.length > 24) throw err('BAD_NAME', 400, 'Name must be 3-24 chars');
    const ex = await this.db.query('SELECT 1 FROM constellations WHERE lower(name) = lower($1)', [clean]);
    if (ex.rows.length) throw err('NAME_TAKEN', 409, 'Name taken');
    const c = { id: randomUUID(), name: clean, createdAt: Date.now(), bloomScore: 0, members: [] };
    this._addMember(c, player, 'founder');
    const ctx = this._ctx();
    if (ctx) ctx.cons.set(c.id, c);
    return c;
  }

  async joinConstellation(player, cid) {
    if (player.constellationId) throw err('IN_GUILD', 409, 'Already in a constellation');
    const c = await this.getConstellation(cid);
    if (!c) throw err('NOT_FOUND', 404, 'No such constellation');
    if (c.members.length >= 30) throw err('GUILD_FULL', 409, 'Constellation full (30)');
    this._addMember(c, player, 'member');
    return c;
  }

  _addMember(c, player, role) {
    c.members.push({ playerId: player.id, handle: player.handle, role, contributed: 0, joinedAt: Date.now() });
    player.constellationId = c.id;
  }

  async contributeBloom(player, amount) {
    if (!player.constellationId) return null;
    const c = await this.getConstellation(player.constellationId);
    if (!c) return null;
    c.bloomScore += amount;
    const m = c.members.find((x) => x.playerId === player.id);
    if (m) m.contributed += amount;
    return c;
  }

  async listConstellations(limit = 20) {
    const r = await this.db.query(
      `SELECT c.id, c.name, c.bloom_score,
              (SELECT count(*) FROM constellation_members WHERE constellation_id = c.id)::int AS members
       FROM constellations c ORDER BY c.bloom_score DESC LIMIT $1`,
      [limit],
    );
    return r.rows.map((x) => ({ id: x.id, name: x.name, members: num(x.members), bloomScore: num(x.bloom_score) }));
  }

  async getConstellation(cid) {
    const ctx = this._ctx();
    if (ctx && ctx.cons.has(cid)) return ctx.cons.get(cid);
    if (!isUuid(cid)) return null;
    const cr = await this.db.query('SELECT id, name, bloom_score FROM constellations WHERE id = $1', [cid]);
    if (!cr.rows.length) return null;
    const mr = await this.db.query(
      `SELECT m.player_id, m.role, m.contributed, p.handle
       FROM constellation_members m JOIN players p ON p.id = m.player_id
       WHERE m.constellation_id = $1`,
      [cid],
    );
    const c = {
      id: cr.rows[0].id, name: cr.rows[0].name, createdAt: Date.now(), bloomScore: num(cr.rows[0].bloom_score),
      members: mr.rows.map((m) => ({ playerId: m.player_id, handle: m.handle, role: m.role, contributed: num(m.contributed), joinedAt: Date.now() })),
    };
    if (ctx) ctx.cons.set(cid, c);
    return c;
  }

  /* -------------------------------- Trades --------------------------------- */

  createTrade(from, to, offer) {
    const trade = {
      id: randomUUID(), fromId: from.id, toId: to.id,
      offerLumi: offer.offerLumi || [], offerPetals: offer.offerPetals || 0,
      requestLumi: offer.requestLumi || [], status: 'open', createdAt: Date.now(),
    };
    const ctx = this._ctx();
    if (ctx) ctx.trades.set(trade.id, trade);
    return trade;
  }

  async getTrade(id) {
    const ctx = this._ctx();
    if (ctx && ctx.trades.has(id)) return ctx.trades.get(id);
    if (!isUuid(id)) return null;
    const r = await this.db.query(
      'SELECT id, from_id, to_id, offer_lumi, offer_petals, request_lumi, status FROM trades WHERE id = $1',
      [id],
    );
    if (!r.rows.length) return null;
    const row = r.rows[0];
    const trade = {
      id: row.id, fromId: row.from_id, toId: row.to_id, offerLumi: row.offer_lumi || [],
      offerPetals: num(row.offer_petals), requestLumi: row.request_lumi || [], status: row.status, createdAt: Date.now(),
    };
    if (ctx) ctx.trades.set(id, trade);
    return trade;
  }

  async listIncomingTrades(playerId) {
    const r = await this.db.query(
      "SELECT id, from_id, to_id, offer_lumi, offer_petals, request_lumi, status FROM trades WHERE to_id = $1 AND status = 'open'",
      [playerId],
    );
    return r.rows.map((row) => ({
      id: row.id, fromId: row.from_id, toId: row.to_id, offerLumi: row.offer_lumi || [],
      offerPetals: num(row.offer_petals), requestLumi: row.request_lumi || [], status: row.status,
    }));
  }

  /* ------------------------------- hydration ------------------------------- */

  async _loadPlayer(id) {
    if (!isUuid(id)) return null; // garbage id → 404, not a Postgres uuid-syntax 500
    const pr = await this.db.query('SELECT id, handle, xp, flags FROM players WHERE id = $1', [id]);
    if (!pr.rows.length) return null;
    const row = pr.rows[0];
    const flags = row.flags || {};
    const w = await this.db.query('SELECT petals, lumen FROM wallets WHERE player_id = $1', [id]);
    const s = await this.db.query('SELECT streak, last_claim_day FROM daily_streaks WHERE player_id = $1', [id]);
    const g = await this.db.query('SELECT biome, bloom, care_streak, decor, layout FROM gardens WHERE player_id = $1', [id]);
    const lr = await this.db.query('SELECT genome FROM lumi WHERE owner_id = $1 ORDER BY created_at', [id]);

    const wrow = w.rows[0] || { petals: 0, lumen: 0 };
    const srow = s.rows[0] || { streak: 0, last_claim_day: null };
    const grow = g.rows[0];
    const garden = grow
      ? { biome: grow.biome, bloom: num(grow.bloom), careStreak: num(grow.care_streak), decor: grow.decor || [], plots: (grow.layout && grow.layout.plots) || [] }
      : createGarden('meadow', 2);

    return {
      id: row.id,
      handle: row.handle,
      createdAt: num(flags.createdAt) || Date.now(),
      wallet: { petals: num(wrow.petals), lumen: num(wrow.lumen) },
      xp: num(row.xp),
      garden,
      collection: lr.rows.map((r) => r.genome),
      ledger: [], // fresh per request; only new entries are appended on commit
      streak: { streak: num(srow.streak), lastClaimDay: srow.last_claim_day == null ? undefined : num(srow.last_claim_day) },
      unlocks: flags.unlocks || { breeding: false, trading: false, visiting: false },
      stats: flags.stats || { lumiHatched: 0, visits: 0, photos: 0 },
      pity: flags.pity || createPity(),
      pass: flags.pass || createPassState(),
      bloomdexClaimed: flags.bloomdexClaimed || [],
      constellationId: flags.constellationId ?? null,
      visitLog: flags.visitLog || { day: 0, ids: [] },
      subscription: flags.subscription || createSubscription(),
    };
  }

  async _loadWorld() {
    const r = await this.db.query('SELECT season, bloom_level, total_lumi_hatched FROM world_state WHERE id = 1');
    const row = r.rows[0] || {};
    return {
      season: row.season || 'spring',
      bloomLevel: num(row.bloom_level),
      totalLumiHatched: num(row.total_lumi_hatched),
      startedAt: Date.now(),
    };
  }

  /* ------------------------------- commit ---------------------------------- */

  async _commit() {
    const ctx = this._ctx();
    if (!ctx) return;
    await this.db.tx(async (q) => {
      // Phase 1: clear lumi for every touched player so trades (which move Lumi
      // between owners) re-insert without primary-key conflicts.
      for (const p of ctx.players.values()) await q('DELETE FROM lumi WHERE owner_id = $1', [p.id]);
      // Phase 2: upsert players (+children) and re-insert their Lumi.
      for (const p of ctx.players.values()) await this._savePlayer(q, p);
      // Identities AFTER players so the player_id FK is satisfied within the tx.
      for (const idn of ctx.identities) {
        await q(
          `INSERT INTO auth_identities (player_id, provider, subject) VALUES ($1, $2, $3)
           ON CONFLICT (provider, subject) DO NOTHING`,
          [idn.playerId, idn.provider, idn.subject],
        );
      }
      // IAP receipts (unique transaction_id is the durable double-redeem guard).
      for (const rc of ctx.receipts) {
        await q(
          `INSERT INTO iap_receipts (player_id, platform, product_id, transaction_id, price_usd_cents, granted_lumen, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'verified')
           ON CONFLICT (transaction_id) DO NOTHING`,
          [rc.playerId, rc.platform, rc.productId, rc.transactionId, rc.priceUsdCents ?? null, rc.grantedLumen ?? null],
        );
      }
      for (const c of ctx.cons.values()) await this._saveConstellation(q, c);
      for (const t of ctx.trades.values()) await this._saveTrade(q, t);
      await this._saveWorld(q);
    });
  }

  async _savePlayer(q, p) {
    const lvl = levelFromXp(p.xp).level;
    const flags = {
      unlocks: p.unlocks, stats: p.stats, pity: p.pity, pass: p.pass,
      bloomdexClaimed: p.bloomdexClaimed, constellationId: p.constellationId,
      visitLog: p.visitLog, subscription: p.subscription, createdAt: p.createdAt,
    };
    await q(
      `INSERT INTO players (id, handle, xp, keeper_level, flags) VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (id) DO UPDATE SET handle = EXCLUDED.handle, xp = EXCLUDED.xp,
         keeper_level = EXCLUDED.keeper_level, flags = EXCLUDED.flags, last_seen_at = now()`,
      [p.id, p.handle, p.xp, lvl, JSON.stringify(flags)],
    );
    await q(
      `INSERT INTO wallets (player_id, petals, lumen) VALUES ($1, $2, $3)
       ON CONFLICT (player_id) DO UPDATE SET petals = EXCLUDED.petals, lumen = EXCLUDED.lumen, updated_at = now()`,
      [p.id, p.wallet.petals, p.wallet.lumen],
    );
    await q(
      `INSERT INTO daily_streaks (player_id, streak, last_claim_day, best_streak) VALUES ($1, $2, $3, $4)
       ON CONFLICT (player_id) DO UPDATE SET streak = EXCLUDED.streak, last_claim_day = EXCLUDED.last_claim_day,
         best_streak = GREATEST(daily_streaks.best_streak, EXCLUDED.best_streak)`,
      [p.id, p.streak.streak || 0, p.streak.lastClaimDay ?? null, p.streak.streak || 0],
    );
    await q(
      `INSERT INTO gardens (player_id, biome, bloom, care_streak, decor, layout)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
       ON CONFLICT (player_id) DO UPDATE SET biome = EXCLUDED.biome, bloom = EXCLUDED.bloom,
         care_streak = EXCLUDED.care_streak, decor = EXCLUDED.decor, layout = EXCLUDED.layout`,
      [p.id, p.garden.biome, p.garden.bloom, p.garden.careStreak || 0, JSON.stringify(p.garden.decor || []), JSON.stringify({ plots: p.garden.plots })],
    );
    for (const l of p.collection) {
      await q(
        `INSERT INTO lumi (id, owner_id, seed, context, rarity, element, form, power, name, mutations, locked, genome)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
        [l.uid, p.id, l.seed, JSON.stringify(l.bornFrom || {}), l.rarity, l.element, l.form, l.power, l.name, l.mutations || [], !!l.locked, JSON.stringify(l)],
      );
    }
    for (const e of p.ledger) {
      await q(
        'INSERT INTO economy_ledger (player_id, currency, delta, reason, kind, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [p.id, e.currency, e.delta, e.reason, e.kind, new Date(e.t).toISOString()],
      );
    }
    p.ledger = []; // persisted; guard against double-insert on a second commit
  }

  async _saveConstellation(q, c) {
    await q(
      `INSERT INTO constellations (id, name, bloom_score) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, bloom_score = EXCLUDED.bloom_score`,
      [c.id, c.name, c.bloomScore],
    );
    await q('DELETE FROM constellation_members WHERE constellation_id = $1', [c.id]);
    for (const m of c.members) {
      await q(
        `INSERT INTO constellation_members (constellation_id, player_id, role, contributed, joined_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (player_id) DO UPDATE SET constellation_id = EXCLUDED.constellation_id,
           role = EXCLUDED.role, contributed = EXCLUDED.contributed`,
        [c.id, m.playerId, m.role, m.contributed || 0, new Date(m.joinedAt || Date.now()).toISOString()],
      );
    }
  }

  async _saveTrade(q, t) {
    await q(
      `INSERT INTO trades (id, from_id, to_id, offer_lumi, offer_petals, request_lumi, status, created_at, resolved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, resolved_at = EXCLUDED.resolved_at`,
      [t.id, t.fromId, t.toId, t.offerLumi || [], t.offerPetals || 0, t.requestLumi || [], t.status,
        new Date(t.createdAt).toISOString(), t.resolvedAt ? new Date(t.resolvedAt).toISOString() : null],
    );
  }

  async _saveWorld(q) {
    const w = this.world;
    await q(
      `INSERT INTO world_state (id, season, bloom_level, total_lumi_hatched, updated_at)
       VALUES (1, $1, $2, $3, now())
       ON CONFLICT (id) DO UPDATE SET season = EXCLUDED.season, bloom_level = EXCLUDED.bloom_level,
         total_lumi_hatched = EXCLUDED.total_lumi_hatched, updated_at = now()`,
      [w.season, w.bloomLevel, w.totalLumiHatched],
    );
  }
}
