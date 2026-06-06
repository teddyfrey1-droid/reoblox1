// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTrade, executeTrade, tradeTax, TRADE_TAX } from '../core/trade.js';
import { generateLumi } from '../core/genome.js';
import { EconomyError } from '../core/economy.js';

/** Build a player-like object with a collection of owned Lumi. */
function makePlayer(id, seeds, petals = 5000) {
  return {
    id,
    wallet: { petals, lumen: 0 },
    ledger: [],
    collection: seeds.map((s, i) => ({ ...generateLumi(s), uid: `${id}-${i}`, locked: false })),
  };
}

test('tradeTax scales with the number of Lumi moved', () => {
  assert.equal(tradeTax({ offerLumi: ['a'], requestLumi: ['b', 'c'] }), TRADE_TAX.base + TRADE_TAX.perLumi * 3);
});

test('valid trade swaps ownership, charges tax and moves petals', () => {
  const from = makePlayer('A', [11, 22]);
  const to = makePlayer('B', [33]);
  const offer = { offerLumi: ['A-0'], offerPetals: 100, requestLumi: ['B-0'] };
  const tax = tradeTax(offer);

  const beforeFromPetals = from.wallet.petals;
  const res = executeTrade(from, to, offer);

  // A-0 moved to B; B-0 moved to A.
  assert.ok(to.collection.some((l) => l.uid === 'A-0'));
  assert.ok(from.collection.some((l) => l.uid === 'B-0'));
  assert.ok(!from.collection.some((l) => l.uid === 'A-0'));
  // Tax burned + 100 petals transferred.
  assert.equal(from.wallet.petals, beforeFromPetals - tax - 100);
  assert.equal(to.wallet.petals, 5000 + 100);
  assert.equal(res.tax, tax);
});

test('locked Lumi cannot be traded', () => {
  const from = makePlayer('A', [11]);
  from.collection[0].locked = true;
  const to = makePlayer('B', [33]);
  assert.throws(() => validateTrade(from, to, { offerLumi: ['A-0'] }), (e) => e instanceof EconomyError && e.code === 'LOCKED');
});

test('trade is atomic: an unaffordable offer mutates nothing', () => {
  const from = makePlayer('A', [11, 22], 50); // not enough for tax + petals
  const to = makePlayer('B', [33]);
  const snapshotFrom = from.collection.map((l) => l.uid).join(',');
  assert.throws(() => executeTrade(from, to, { offerLumi: ['A-0'], offerPetals: 100, requestLumi: ['B-0'] }),
    (e) => e.code === 'INSUFFICIENT_FUNDS');
  assert.equal(from.wallet.petals, 50, 'petals untouched');
  assert.equal(from.collection.map((l) => l.uid).join(','), snapshotFrom, 'collection untouched');
  assert.ok(!to.collection.some((l) => l.uid === 'A-0'), 'nothing moved');
});

test('cannot trade with yourself or send an empty trade', () => {
  const a = makePlayer('A', [11]);
  assert.throws(() => validateTrade(a, a, { offerLumi: ['A-0'] }), (e) => e.code === 'SELF_TRADE');
  const b = makePlayer('B', [33]);
  assert.throws(() => validateTrade(a, b, {}), (e) => e.code === 'EMPTY_TRADE');
});
