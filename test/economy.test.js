// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWallet, credit, debit, pay, grant, purchase, faucetSinkReport, EconomyError,
} from '../core/economy.js';

test('credit and debit move funds and respect zero floor', () => {
  const w = createWallet();
  credit(w, 'petals', 500, 'test');
  assert.equal(w.petals, 500);
  debit(w, 'petals', 200, 'test');
  assert.equal(w.petals, 300);
});

test('debit refuses to overspend', () => {
  const w = createWallet();
  credit(w, 'lumen', 10, 'test');
  assert.throws(() => debit(w, 'lumen', 11, 'test'), (e) => e instanceof EconomyError && e.code === 'INSUFFICIENT_FUNDS');
  assert.equal(w.lumen, 10, 'wallet unchanged after failed debit');
});

test('credit clamps to the currency hard cap', () => {
  const w = createWallet();
  const applied = credit(w, 'lumen', 10_000_000, 'whale');
  assert.equal(w.lumen, 999_999);
  assert.equal(applied, 999_999);
});

test('pay is atomic: a partially-affordable multi-currency cost charges nothing', () => {
  const w = createWallet();
  credit(w, 'petals', 1000, 'seed');
  // Cost needs lumen the player does not have → must not consume the petals either.
  assert.throws(() => pay(w, { petals: 500, lumen: 50 }, 'combo'));
  assert.equal(w.petals, 1000, 'petals must be untouched after failed atomic pay');
});

test('purchase validates catalog items and prices', () => {
  const w = createWallet();
  credit(w, 'petals', 10_000, 'grant');
  const def = purchase(w, 'plant', 'dewbud');
  assert.equal(def.id, 'dewbud');
  assert.equal(w.petals, 10_000 - 50);
  assert.throws(() => purchase(w, 'plant', 'nonsense'), (e) => e.code === 'UNKNOWN_ITEM');
});

test('grant applies rewards and reports what landed', () => {
  const w = createWallet();
  const applied = grant(w, { petals: 120, lumen: 5 }, 'daily');
  assert.deepEqual(applied, { petals: 120, lumen: 5 });
  assert.equal(w.petals, 120);
});

test('ledger powers a faucet/sink inflation report', () => {
  const w = createWallet();
  /** @type {any[]} */
  const ledger = [];
  grant(w, { petals: 1000 }, 'daily_reward', ledger);   // source
  grant(w, { petals: 1000 }, 'quest', ledger);          // source
  purchase(w, 'plant', 'sunpetal', ledger);             // sink 260
  purchase(w, 'decor', 'lantern_post', ledger);         // sink 220
  const report = faucetSinkReport(ledger);
  assert.equal(report.petals.source, 2000);
  assert.equal(report.petals.sink, 480);
  assert.ok(report.petalsFaucetSinkRatio > 1, 'this sample is inflationary as expected');
});
