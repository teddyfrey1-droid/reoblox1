// @ts-check
/**
 * Monetisation tests: subscription logic (unit) and the server-validated, IDEMPOTENT
 * IAP redeem pipeline (integration) — a transaction can never be redeemed twice
 * (money correctness), invalid receipts are rejected, and the subscription grants its
 * daily stipend once per day.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/api.js';
import { MemoryStore } from '../server/store.js';
import { testReceipt } from '../server/iap.js';
import {
  createSubscription, isActive, extend, claimStipend, subscriptionView,
} from '../core/subscription.js';

const DAY = 24 * 60 * 60 * 1000;

/* ------------------------------- unit ------------------------------------ */

test('subscription activates, stacks on renewal, and reports days left', () => {
  const s = createSubscription();
  assert.equal(isActive(s, Date.now()), false);
  const t0 = 1_000 * DAY;
  extend(s, 'golden_garden', 30, t0);
  assert.equal(isActive(s, t0), true);
  assert.equal(subscriptionView(s, t0).daysLeft, 30);
  // Renew before expiry → stacks (does not reset/lose paid time).
  extend(s, 'golden_garden', 30, t0 + 10 * DAY);
  assert.equal(subscriptionView(s, t0 + 10 * DAY).daysLeft, 50);
});

test('daily stipend pays once per day while active', () => {
  const s = createSubscription();
  const t0 = 2_000 * DAY + 8 * 3600 * 1000;
  assert.equal(claimStipend(s, t0).claimed, false, 'inactive → no stipend');
  extend(s, 'golden_garden', 30, t0);
  const first = claimStipend(s, t0);
  assert.equal(first.claimed, true);
  assert.ok(first.lumen > 0);
  assert.equal(claimStipend(s, t0 + 1000).claimed, false, 'same day → no second stipend');
  assert.equal(claimStipend(s, t0 + DAY).claimed, true, 'next day → stipend again');
});

/* --------------------------- integration --------------------------------- */

let server;
let base;
const SECRET = 'test-iap-secret';
before(async () => {
  server = createServer(createApp(new MemoryStore(), { iapTestSecret: SECRET }));
  await new Promise((res) => server.listen(0, res));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function api(path, method = 'GET', body) {
  const r = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
const newPlayer = async (h) => (await api('/api/players', 'POST', { handle: h })).data.player;
const redeem = (id, productId, transactionId) => api(`/api/players/${id}/iap/redeem`, 'POST', {
  platform: 'test', productId, transactionId, receipt: testReceipt(SECRET, productId, transactionId),
});

test('store exposes the product catalog', async () => {
  const { data } = await api('/api/store/products');
  assert.ok(data.products.some((p) => p.id === 'lumen_pouch'));
  assert.ok(data.products.some((p) => p.kind === 'subscription'));
});

test('a verified Lumen purchase credits the wallet', async () => {
  const p = await newPlayer('iap_buyer');
  const before = p.wallet.lumen; // 50 onboarding
  const r = await redeem(p.id, 'lumen_pouch', 'tx-pouch-1');
  assert.equal(r.status, 200);
  assert.equal(r.data.redeemed, true);
  assert.equal(r.data.wallet.lumen, before + 500);
});

test('redeeming the same transaction twice never double-credits (idempotent)', async () => {
  const p = await newPlayer('iap_dup');
  const first = await redeem(p.id, 'lumen_pouch', 'tx-dup-1');
  assert.equal(first.data.wallet.lumen, 50 + 500);
  const second = await redeem(p.id, 'lumen_pouch', 'tx-dup-1'); // same tx id
  assert.equal(second.data.alreadyRedeemed, true);
  assert.equal(second.data.wallet.lumen, 50 + 500, 'no second credit');
  // A different transaction id does grant again.
  const third = await redeem(p.id, 'lumen_pouch', 'tx-dup-2');
  assert.equal(third.data.wallet.lumen, 50 + 1000);
});

test('concurrent redeems of one transaction credit only once (no TOCTOU double-grant)', async () => {
  const p = await newPlayer('iap_race');
  const fire = () => redeem(p.id, 'lumen_pouch', 'race-tx-1');
  const results = await Promise.all([fire(), fire(), fire(), fire(), fire()]);
  const redeemed = results.filter((r) => r.data.redeemed).length;
  const already = results.filter((r) => r.data.alreadyRedeemed).length;
  assert.equal(redeemed, 1, 'exactly one concurrent request grants');
  assert.equal(already, 4, 'the rest see alreadyRedeemed');
  assert.equal((await api(`/api/players/${p.id}`)).data.player.wallet.lumen, 50 + 500, 'credited once');
});

test('a forged/invalid receipt is rejected (402) and unknown product (400)', async () => {
  const p = await newPlayer('iap_bad');
  const forged = await api(`/api/players/${p.id}/iap/redeem`, 'POST', {
    platform: 'test', productId: 'lumen_pouch', transactionId: 'tx-bad-1', receipt: 'forged',
  });
  assert.equal(forged.status, 402);
  const unknown = await api(`/api/players/${p.id}/iap/redeem`, 'POST', {
    platform: 'test', productId: 'no_such_product', transactionId: 'tx-bad-2', receipt: 'x',
  });
  assert.equal(unknown.status, 400);
  // Unconfigured real provider is an honest 501, not a fake success.
  const apple = await api(`/api/players/${p.id}/iap/redeem`, 'POST', {
    platform: 'apple', productId: 'lumen_pouch', transactionId: 'tx-bad-3', receipt: 'x',
  });
  assert.equal(apple.status, 501);
});

test('subscription purchase activates Golden Garden and grants the daily stipend', async () => {
  const p = await newPlayer('iap_sub');
  const r = await redeem(p.id, 'golden_garden', 'tx-sub-1');
  assert.equal(r.data.subscription.active, true);
  assert.equal(r.data.subscription.tier, 'golden_garden');

  const view = await api(`/api/players/${p.id}/subscription`);
  assert.equal(view.data.subscription.active, true);

  const lumenBefore = (await api(`/api/players/${p.id}`)).data.player.wallet.lumen;
  const stipend = await api(`/api/players/${p.id}/subscription/stipend`, 'POST');
  assert.equal(stipend.status, 200);
  assert.ok(stipend.data.lumen > 0);
  assert.equal(stipend.data.wallet.lumen, lumenBefore + stipend.data.lumen);
  // Second claim same day → 400.
  assert.equal((await api(`/api/players/${p.id}/subscription/stipend`, 'POST')).status, 400);
});
