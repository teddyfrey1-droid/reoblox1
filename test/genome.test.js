// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateLumi, breedLumi, encodeSeedCode, decodeSeedCode, RARITIES,
} from '../core/genome.js';

test('generation is deterministic: same seed → identical genome', () => {
  const a = generateLumi(123456, { biome: 'meadow', season: 'spring' });
  const b = generateLumi(123456, { biome: 'meadow', season: 'spring' });
  assert.deepEqual(a, b);
});

test('different seeds produce different creatures (high variety)', () => {
  const names = new Set();
  const species = new Set();
  for (let i = 0; i < 500; i++) {
    const g = generateLumi(i * 2654435761);
    names.add(g.seedCode);
    species.add(`${g.species}/${g.pattern}/${g.palette.primary}`);
  }
  assert.equal(names.size, 500, 'every seed yields a unique seed code');
  assert.ok(species.size > 250, `expected high variety, got ${species.size} distinct looks`);
});

test('string seed codes are stable and round-trip', () => {
  for (const seed of [0, 1, 42, 65535, 4294967295, 2654435761]) {
    const code = encodeSeedCode(seed >>> 0);
    assert.equal(decodeSeedCode(code), seed >>> 0, `round-trip failed for ${seed}`);
  }
});

test('rarity distribution roughly matches configured weights', () => {
  /** @type {Record<string, number>} */
  const counts = {};
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const g = generateLumi(i + 1); // neutral context (no luck)
    counts[g.rarity] = (counts[g.rarity] || 0) + 1;
  }
  // Common should dominate; mythic should be very rare but should appear at this N.
  assert.ok(counts.common / N > 0.55, `common share too low: ${counts.common / N}`);
  assert.ok((counts.mythic || 0) >= 1, 'expected at least one mythic in 20k rolls');
  assert.ok((counts.legendary || 0) < counts.epic, 'legendary rarer than epic');
  assert.ok(counts.epic < counts.rare, 'epic rarer than rare');
});

test('world bloom + care quality shift rarity upward (the tending incentive)', () => {
  const score = (ctx) => {
    let total = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const g = generateLumi(i + 7, ctx);
      total += RARITIES.findIndex((r) => r.id === g.rarity);
    }
    return total / N;
  };
  const plain = score({ bloomLevel: 0, careQuality: 0 });
  const blessed = score({ bloomLevel: 100, careQuality: 1 });
  assert.ok(blessed > plain * 1.3, `blessed (${blessed.toFixed(3)}) should beat plain (${plain.toFixed(3)})`);
});

test('render spec is always present and self-consistent', () => {
  const g = generateLumi('LUMI-TEST-SEED');
  assert.ok(g.render.palette.primary.startsWith('#'));
  assert.equal(g.render.coat.pattern, g.pattern);
  assert.ok(g.power === g.stats.charm + g.stats.vigor + g.stats.harmony + g.stats.spark);
});

test('breeding is deterministic and records lineage', () => {
  const mom = generateLumi(111, { biome: 'tide_pools' });
  const dad = generateLumi(222, { biome: 'emberfall' });
  const c1 = breedLumi(mom, dad, { ritualSeed: 999, bloomLevel: 50 });
  const c2 = breedLumi(mom, dad, { ritualSeed: 999, bloomLevel: 50 });
  assert.deepEqual(c1, c2, 'same parents + ritual → same child');
  assert.equal(c1.lineage.length, 2);
  assert.equal(c1.lineage[0], encodeSeedCode(mom.seed));
});

test('breeding can climb rarity but does not run away (scarcity preserved)', () => {
  const hi = generateLumi(5, {});
  // Force a couple of legendary parents by searching seeds (deterministic search).
  let lega = null, legb = null;
  for (let i = 0; i < 100000 && (!lega || !legb); i++) {
    const g = generateLumi(i, { bloomLevel: 100, careQuality: 1 });
    if (g.rarity === 'legendary') { if (!lega) lega = g; else if (!legb) legb = g; }
  }
  assert.ok(lega && legb, 'found two legendary parents');
  let mythicChildren = 0;
  for (let i = 0; i < 2000; i++) {
    const child = breedLumi(lega, legb, { ritualSeed: i, bloomLevel: 100 });
    if (child.rarity === 'mythic') mythicChildren++;
  }
  // Climbing is possible but capped — mythic should be a minority of legendary×legendary.
  assert.ok(mythicChildren > 0, 'breeding two legendaries can yield mythic');
  assert.ok(mythicChildren < 2000 * 0.5, 'mythic should remain scarce even from top parents');
});
