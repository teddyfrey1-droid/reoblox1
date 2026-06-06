// @ts-check
/**
 * Persistence layer (in-memory reference implementation).
 *
 * This implements the `PlayerStore` interface the API depends on. The MVP runs it
 * in-memory so the whole stack boots with zero infrastructure. In production the
 * SAME interface is implemented over Postgres (see db/schema.sql) + Redis for the
 * hot world state — the API layer never has to change.
 *
 * Determinism note: the store holds raw state only. All game logic lives in /core,
 * so the store can be swapped without touching balance or rules.
 */

import { randomUUID } from 'node:crypto';
import { createWallet } from '../core/economy.js';
import { createGarden } from '../core/garden.js';
import { generateLumi } from '../core/genome.js';
import { hashString } from '../core/rng.js';
import { createPity } from '../core/luck.js';
import { createPassState } from '../core/pass.js';

export class MemoryStore {
  constructor() {
    /** @type {Map<string, object>} */
    this.players = new Map();
    /** @type {Map<string, string>} */
    this.handleToId = new Map();
    /** @type {Map<string, object>} */
    this.constellations = new Map();
    /** @type {Map<string, object>} */
    this.trades = new Map();
    /** Global, shared world state — the "Great Bloom" meta. */
    this.world = {
      season: 'spring',
      bloomLevel: 12, // 0..100 community progress; rises with collective harvests
      totalLumiHatched: 0,
      startedAt: Date.now(),
    };
  }

  /**
   * Create a new player with a starter garden, wallet and empty collection.
   * @param {string} handle  unique display handle
   */
  createPlayer(handle) {
    if (this.handleToId.has(handle.toLowerCase())) {
      throw Object.assign(new Error('Handle already taken'), { code: 'HANDLE_TAKEN', status: 409 });
    }
    const id = randomUUID();
    const player = newPlayer(id, handle);
    this.players.set(id, player);
    this.handleToId.set(handle.toLowerCase(), id);

    // Two starter Lumi so Collection and Bloom Ritual are immediately meaningful
    // (a "starter pair" is standard onboarding for collection games).
    for (const lumi of starterLumi(handle, this.world)) this.addLumi(player, lumi);
    return player;
  }

  /**
   * Per-request unit of work. The MemoryStore mutates live object references, so
   * persistence is implicit — this is a no-op wrapper that simply runs the handler.
   * (PgStore overrides it to load/commit a transaction.) Kept on both stores so the
   * API request loop is store-agnostic.
   * @param {string} _method @param {() => any} fn
   */
  async withRequest(_method, fn) {
    return fn();
  }

  /** @param {string} id */
  getPlayer(id) {
    const p = this.players.get(id);
    if (!p) throw Object.assign(new Error('Player not found'), { code: 'NOT_FOUND', status: 404 });
    return p;
  }

  /** @param {string} handle */
  getPlayerByHandle(handle) {
    const id = this.handleToId.get(handle.toLowerCase());
    return id ? this.players.get(id) : null;
  }

  /** Public neighbour list for the "visit" feature (no private fields). */
  listNeighbours(excludeId, limit = 12) {
    const out = [];
    for (const p of this.players.values()) {
      if (p.id === excludeId) continue;
      out.push({
        id: p.id,
        handle: p.handle,
        biome: p.garden.biome,
        bloom: p.garden.bloom,
        collectionSize: p.collection.length,
        showcase: p.collection.slice(-3).map(slimLumi),
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * Add a Lumi to a player's collection and update world + player counters.
   * @param {object} player @param {object} lumi
   */
  addLumi(player, lumi) {
    const owned = { ...lumi, uid: randomUUID(), caughtAt: Date.now() };
    player.collection.push(owned);
    player.stats.lumiHatched += 1;
    this.world.totalLumiHatched += 1;
    // Collective progress: every hatch nudges the shared world bloom (with diminishing
    // returns) — this is the visible "we are restoring the world together" meta.
    this.world.bloomLevel = Math.min(100, this.world.bloomLevel + 0.001);
    return owned;
  }

  /** Leaderboard by collection power (simple, swappable for a Redis sorted set). */
  leaderboard(limit = 10) {
    const rows = [...this.players.values()].map((p) => ({
      handle: p.handle,
      collectionSize: p.collection.length,
      topPower: p.collection.reduce((m, l) => Math.max(m, l.power || 0), 0),
      bloom: p.garden.bloom,
    }));
    rows.sort((a, b) => b.topPower - a.topPower || b.collectionSize - a.collectionSize);
    return rows.slice(0, limit);
  }

  /* ----------------------------- Constellations ---------------------------- */

  /** Found a constellation (guild). The creator becomes its founder. */
  createConstellation(player, name) {
    if (player.constellationId) throw Object.assign(new Error('Already in a constellation'), { code: 'IN_GUILD', status: 409 });
    const clean = String(name || '').trim();
    if (clean.length < 3 || clean.length > 24) throw Object.assign(new Error('Name must be 3-24 chars'), { code: 'BAD_NAME', status: 400 });
    for (const c of this.constellations.values()) {
      if (c.name.toLowerCase() === clean.toLowerCase()) throw Object.assign(new Error('Name taken'), { code: 'NAME_TAKEN', status: 409 });
    }
    const id = randomUUID();
    const c = { id, name: clean, createdAt: Date.now(), bloomScore: 0, members: [] };
    this.constellations.set(id, c);
    this._addMember(c, player, 'founder');
    return c;
  }

  joinConstellation(player, cid) {
    const c = this.constellations.get(cid);
    if (!c) throw Object.assign(new Error('No such constellation'), { code: 'NOT_FOUND', status: 404 });
    if (player.constellationId) throw Object.assign(new Error('Already in a constellation'), { code: 'IN_GUILD', status: 409 });
    if (c.members.length >= 30) throw Object.assign(new Error('Constellation full (30)'), { code: 'GUILD_FULL', status: 409 });
    this._addMember(c, player, 'member');
    return c;
  }

  _addMember(c, player, role) {
    c.members.push({ playerId: player.id, handle: player.handle, role, contributed: 0, joinedAt: Date.now() });
    player.constellationId = c.id;
  }

  /** Contribute bloom to the player's constellation (called on hatch). */
  contributeBloom(player, amount) {
    if (!player.constellationId) return null;
    const c = this.constellations.get(player.constellationId);
    if (!c) return null;
    c.bloomScore += amount;
    const m = c.members.find((x) => x.playerId === player.id);
    if (m) m.contributed += amount;
    return c;
  }

  listConstellations(limit = 20) {
    return [...this.constellations.values()]
      .map((c) => ({ id: c.id, name: c.name, members: c.members.length, bloomScore: c.bloomScore }))
      .sort((a, b) => b.bloomScore - a.bloomScore)
      .slice(0, limit);
  }

  getConstellation(cid) {
    return this.constellations.get(cid) || null;
  }

  /* -------------------------------- Trades --------------------------------- */

  createTrade(from, to, offer) {
    const id = randomUUID();
    const trade = {
      id, fromId: from.id, toId: to.id,
      offerLumi: offer.offerLumi || [], offerPetals: offer.offerPetals || 0,
      requestLumi: offer.requestLumi || [], status: 'open', createdAt: Date.now(),
    };
    this.trades.set(id, trade);
    return trade;
  }

  getTrade(id) {
    return this.trades.get(id) || null;
  }

  listIncomingTrades(playerId) {
    return [...this.trades.values()].filter((t) => t.toId === playerId && t.status === 'open');
  }

  getWorld() {
    return { ...this.world, uptimeMs: Date.now() - this.world.startedAt };
  }
}

/**
 * Build a fresh player object (single source of truth for the player shape, shared
 * by MemoryStore and PgStore so the two can never drift). Does NOT add starter Lumi
 * — the caller adds them via addLumi so each store updates its world counters.
 * @param {string} id @param {string} handle
 */
export function newPlayer(id, handle) {
  const wallet = createWallet();
  // Onboarding grant: soft currency to spend + a one-time taste of premium currency
  // so new players can try the Bloom Ritual once (a deliberate conversion tactic).
  wallet.petals = 300;
  wallet.lumen = 50;
  return {
    id,
    handle,
    createdAt: Date.now(),
    wallet,
    xp: 0,
    garden: createGarden('meadow', 2),
    /** @type {object[]} */ collection: [],
    ledger: /** @type {any[]} */ ([]),
    streak: { streak: 0, lastClaimDay: undefined },
    unlocks: { breeding: false, trading: false, visiting: false },
    stats: { lumiHatched: 0, visits: 0, photos: 0 },
    pity: createPity(),
    pass: createPassState(),
    bloomdexClaimed: [],
    constellationId: null,
  };
}

/** The two deterministic starter Lumi granted on signup. */
export function starterLumi(handle, world) {
  return [0, 1].map((i) => generateLumi((hashString(`${handle}:starter:${i}`)) >>> 0, {
    biome: 'meadow', season: world.season, bloomLevel: world.bloomLevel, careQuality: 0.55,
  }));
}

/** Compact Lumi projection for lists/showcases (keeps payloads small). */
export function slimLumi(l) {
  return {
    uid: l.uid,
    name: l.name,
    species: l.species,
    rarity: l.rarity,
    element: l.element,
    seedCode: l.seedCode,
    power: l.power,
    palette: l.palette,
  };
}
