// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { bloomdex, claimableMilestones, BLOOMDEX_TOTALS } from '../core/bloomdex.js';

/** Minimal Lumi-like rows (only the fields the Bloomdex reads). */
const lumi = (element, form, rarity = 'common', mutations = []) => ({ element, form, rarity, mutations, species: `${element}:${form}` });

test('empty collection → everything at zero', () => {
  const dex = bloomdex([]);
  assert.equal(dex.discovered.species, 0);
  assert.equal(dex.completion.species, 0);
  assert.deepEqual(dex.milestonesReached, []);
});

test('counts distinct species, elements, forms, rarities, mutations', () => {
  const dex = bloomdex([
    lumi('water', 'critter', 'rare', ['aurora']),
    lumi('water', 'critter', 'common'),          // duplicate species
    lumi('sun', 'floater', 'epic', ['halo']),
    lumi('moon', 'wyrm', 'mythic', ['aurora']),  // duplicate mutation
  ]);
  assert.equal(dex.discovered.species, 3);
  assert.equal(dex.discovered.elements, 3);
  assert.equal(dex.discovered.forms, 3);
  assert.equal(dex.discovered.rarities, 4);
  assert.equal(dex.discovered.mutations, 2);
  assert.equal(dex.totals.species, BLOOMDEX_TOTALS.species);
});

test('species completion percentage is correct', () => {
  // 4 distinct species out of 36 → 11.1%
  const dex = bloomdex([
    lumi('water', 'critter'), lumi('sun', 'floater'), lumi('moon', 'wyrm'), lumi('earth', 'tot'),
  ]);
  assert.equal(dex.discovered.species, 4);
  assert.equal(dex.completion.species, 11.1);
  assert.ok(dex.milestonesReached.includes('dex_10'));
  assert.ok(!dex.milestonesReached.includes('dex_25'));
});

test('claimableMilestones excludes already-claimed and sums rewards', () => {
  const collection = [
    lumi('water', 'critter'), lumi('sun', 'floater'), lumi('moon', 'wyrm'), lumi('earth', 'tot'),
  ];
  const { milestones, reward } = claimableMilestones(collection, []);
  assert.deepEqual(milestones.map((m) => m.id), ['dex_10']);
  assert.equal(reward.petals, 500);
  const again = claimableMilestones(collection, ['dex_10']);
  assert.equal(again.milestones.length, 0);
  assert.equal(again.reward.petals, 0);
});
