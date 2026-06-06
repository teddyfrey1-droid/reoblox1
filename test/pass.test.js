// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPassState, tierFromXp, addPassXp, claimableTiers, claimTier, upgradeToPremium, passView,
} from '../core/pass.js';
import { BLOOM_PASS } from '../core/content.js';

test('tier is derived from XP and capped at the season length', () => {
  assert.equal(tierFromXp(0), 0);
  assert.equal(tierFromXp(BLOOM_PASS.xpPerTier), 1);
  assert.equal(tierFromXp(BLOOM_PASS.xpPerTier * 2.5), 2);
  assert.equal(tierFromXp(BLOOM_PASS.xpPerTier * 999), BLOOM_PASS.tiers);
});

test('addPassXp reports tiers gained', () => {
  const s = createPassState();
  const r = addPassXp(s, BLOOM_PASS.xpPerTier * 3 + 10);
  assert.equal(r.tier, 3);
  assert.equal(r.tiersGained, 3);
});

test('free lane is claimable; premium lane requires ownership', () => {
  const s = createPassState();
  addPassXp(s, BLOOM_PASS.xpPerTier * 5); // reach tier 5 (a sampled reward tier)
  const free = claimableTiers(s);
  assert.ok(free.some((t) => t.tier === 1 && t.lane === 'free'));
  assert.ok(!free.some((t) => t.lane === 'premium'), 'no premium claims without the premium pass');
  upgradeToPremium(s);
  const withPrem = claimableTiers(s);
  assert.ok(withPrem.some((t) => t.lane === 'premium'));
});

test('claiming a tier is idempotent', () => {
  const s = createPassState();
  addPassXp(s, BLOOM_PASS.xpPerTier * 2);
  const reward = claimTier(s, 1, 'free');
  assert.ok(reward, 'first claim returns a reward');
  assert.equal(claimTier(s, 1, 'free'), null, 'second claim returns nothing');
});

test('cannot claim an unreached tier or unowned premium lane', () => {
  const s = createPassState();
  assert.throws(() => claimTier(s, 50, 'free'), /not yet reached/i);
  addPassXp(s, BLOOM_PASS.xpPerTier * 50);
  assert.throws(() => claimTier(s, 50, 'premium'), /premium/i);
});

test('passView exposes a client-friendly summary', () => {
  const s = createPassState();
  addPassXp(s, BLOOM_PASS.xpPerTier + 250);
  const v = passView(s);
  assert.equal(v.tier, 1);
  assert.equal(v.xpIntoTier, 250);
  assert.equal(v.maxTier, BLOOM_PASS.tiers);
});
