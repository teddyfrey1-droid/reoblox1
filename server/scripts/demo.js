// @ts-check
/**
 * Seed a demo world: a handful of neighbours each holding a small, pre-generated
 * collection, plus a ready-to-use demo player with currency to spend. This makes
 * the prototype feel alive on first load (social proof + populated leaderboards)
 * without any database.
 *
 * Run standalone:  node server/scripts/demo.js   (prints a sample collection)
 */

import { MemoryStore } from '../store.js';
import { generateLumi } from '../../core/genome.js';
import { grant } from '../../core/economy.js';

const NEIGHBOUR_HANDLES = [
  ['mossy_pip', 'glade'], ['tide_lena', 'tide_pools'], ['noctus', 'nocturne'],
  ['sunny_rema', 'dunes'], ['ember_kai', 'emberfall'], ['bloomgran', 'meadow'],
];

/**
 * @param {MemoryStore} store
 */
export function seedDemoWorld(store) {
  // Bump the shared world bloom so demo creatures roll a satisfying spread.
  store.world.bloomLevel = 35;

  for (const [handle, biome] of NEIGHBOUR_HANDLES) {
    const p = store.createPlayer(handle);
    p.garden.biome = biome;
    p.garden.bloom = 20 + (hash(handle) % 60);
    const count = 4 + (hash(handle) % 6);
    for (let i = 0; i < count; i++) {
      const lumi = generateLumi(hash(handle + i) >>> 0, {
        biome, season: store.world.season, bloomLevel: store.world.bloomLevel,
        careQuality: 0.6 + (i % 3) * 0.1,
      });
      store.addLumi(p, lumi);
    }
  }

  // The demo player the prototype logs in as by default.
  const demo = store.createPlayer('keeper_demo');
  grant(demo.wallet, { petals: 4000, lumen: 200 }, 'demo_grant', demo.ledger);
  // Give them a couple of starter Lumi so breeding is immediately demoable.
  for (let i = 0; i < 3; i++) {
    store.addLumi(demo, generateLumi((0xC0FFEE + i * 7919) >>> 0, {
      biome: 'meadow', season: store.world.season, bloomLevel: store.world.bloomLevel, careQuality: 0.7,
    }));
  }
  return demo;
}

/** Tiny stable string hash for demo determinism. */
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Allow running directly for a quick sanity check.
if (import.meta.url === `file://${process.argv[1]}`) {
  const store = new MemoryStore();
  const demo = seedDemoWorld(store);
  console.log('Demo player:', demo.handle, demo.id);
  console.log('Wallet:', demo.wallet);
  console.log('Leaderboard:', store.leaderboard(5));
  console.log('Sample neighbour Lumi:',
    store.listNeighbours(demo.id, 1)[0]?.showcase?.map((l) => `${l.name} (${l.rarity} ${l.species})`));
}
