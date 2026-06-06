// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPity, pityFloor, recordHatch, PITY } from '../core/luck.js';
import { generateLumi } from '../core/genome.js';

const RANK = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 };

test('fresh pity has no dry streak and no floor', () => {
  const p = createPity();
  assert.deepEqual(p, { sinceRare: 0, sinceEpic: 0 });
  assert.equal(pityFloor(p), null);
});

test('pity floor triggers rare, then epic, at the thresholds', () => {
  const p = { sinceRare: PITY.rareEvery - 1, sinceEpic: 0 };
  assert.equal(pityFloor(p), 'rare');
  const q = { sinceRare: 0, sinceEpic: PITY.epicEvery - 1 };
  assert.equal(pityFloor(q), 'epic');
});

test('recordHatch resets the right counters', () => {
  const p = createPity();
  recordHatch(p, 'common');
  assert.deepEqual(p, { sinceRare: 1, sinceEpic: 1 });
  recordHatch(p, 'rare');         // satisfies rare track only
  assert.equal(p.sinceRare, 0);
  assert.equal(p.sinceEpic, 2);
  recordHatch(p, 'legendary');    // satisfies both
  assert.deepEqual(p, { sinceRare: 0, sinceEpic: 0 });
});

test('end-to-end: pity guarantees a rare+ at least every rareEvery hatches', () => {
  // Neutral context → natural rares are uncommon, so the floor must do real work.
  const pity = createPity();
  let gap = 0;
  let maxGap = 0;
  let rescues = 0;
  for (let i = 0; i < 400; i++) {
    const floor = pityFloor(pity);
    if (floor) rescues++;
    const lumi = generateLumi(i * 2654435761 + 7, floor ? { rarityFloor: floor } : {});
    if (RANK[lumi.rarity] >= RANK.rare) { maxGap = Math.max(maxGap, gap); gap = 0; }
    else gap++;
    recordHatch(pity, lumi.rarity);
  }
  assert.ok(maxGap < PITY.rareEvery, `max dry streak ${maxGap} should be < ${PITY.rareEvery}`);
  assert.ok(rescues > 0, 'pity should have rescued at least once over 400 neutral hatches');
});
