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

export class MemoryStore {
  constructor() {
    /** @type {Map<string, object>} */
    this.players = new Map();
    /** @type {Map<string, string>} */
    this.handleToId = new Map();
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
    const wallet = createWallet();
    // Onboarding grant: soft currency to spend, plus a small one-time taste of premium
    // currency so new players can try the Bloom Ritual (premium feature) once — a
    // deliberate conversion tactic (let them experience the value before paying).
    wallet.petals = 300;
    wallet.lumen = 50;
    const player = {
      id,
      handle,
      createdAt: Date.now(),
      wallet,
      xp: 0,
      garden: createGarden('meadow', 2),
      /** @type {object[]} */ collection: [], // owned Lumi genomes
      ledger: /** @type {any[]} */ ([]),
      streak: { streak: 0, lastClaimDay: undefined },
      unlocks: { breeding: false, trading: false, visiting: false },
      stats: { lumiHatched: 0, visits: 0, photos: 0 },
    };
    this.players.set(id, player);
    this.handleToId.set(handle.toLowerCase(), id);

    // Two starter Lumi so Collection and Bloom Ritual are immediately meaningful
    // (a "starter pair" is standard onboarding for collection games).
    for (let i = 0; i < 2; i++) {
      const seed = (hashString(`${handle}:starter:${i}`)) >>> 0;
      this.addLumi(player, generateLumi(seed, {
        biome: player.garden.biome, season: this.world.season,
        bloomLevel: this.world.bloomLevel, careQuality: 0.55,
      }));
    }
    return player;
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

  getWorld() {
    return { ...this.world, uptimeMs: Date.now() - this.world.startedAt };
  }
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
