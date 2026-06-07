// @ts-check
/**
 * Real payment-verifier tests:
 *  - Stripe webhook signature verification (unit) + an idempotent webhook handler that
 *    grants once and rejects bad/stale signatures.
 *  - Apple/Google verification via an injected transport (the prod network call is
 *    faked here; the decision logic is real).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/api.js';
import { MemoryStore } from '../server/store.js';
import { verifyStripeSignature, stripeSignatureHeader, testReceipt } from '../server/iap.js';

const STRIPE_SECRET = 'whsec_test_123';
const IAP_TEST_SECRET = 'iap-test';

/* ------------------------------- unit ------------------------------------ */

test('Stripe signature: valid passes, tampered/stale/missing fail', () => {
  const raw = JSON.stringify({ id: 'evt_x', hello: 'world' });
  const header = stripeSignatureHeader(raw, STRIPE_SECRET);
  assert.ok(verifyStripeSignature(raw, header, STRIPE_SECRET));
  // Tampered body → mismatch.
  assert.throws(() => verifyStripeSignature(raw + 'x', header, STRIPE_SECRET), (e) => e.status === 400);
  // Stale timestamp → outside tolerance.
  const stale = stripeSignatureHeader(raw, STRIPE_SECRET, Math.floor(Date.now() / 1000) - 10000);
  assert.throws(() => verifyStripeSignature(raw, stale, STRIPE_SECRET), (e) => e.code === 'SIGNATURE_EXPIRED');
  // No secret configured → 501.
  assert.throws(() => verifyStripeSignature(raw, header, ''), (e) => e.status === 501);
});

/* --------------------------- integration --------------------------------- */

let server;
let base;
const transport = {
  apple: async ({ productId, transactionId, receipt }) => (receipt === 'bad' ? { ok: false } : { ok: true, productId, transactionId }),
  google: async ({ productId, transactionId }) => ({ ok: true, productId, transactionId }),
};

before(async () => {
  server = createServer(createApp(new MemoryStore(), {
    iapTestSecret: IAP_TEST_SECRET, stripeWebhookSecret: STRIPE_SECRET, iapTransport: transport,
  }));
  await new Promise((res) => server.listen(0, res));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function api(path, method = 'GET', body, rawHeaders) {
  const headers = { ...(rawHeaders || {}) };
  let payload;
  if (typeof body === 'string') { payload = body; }
  else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(base + path, { method, headers, body: payload });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
const newPlayer = async (h) => (await api('/api/players', 'POST', { handle: h })).data.player;

function stripeEvent(id, playerId, productId, type = 'payment_intent.succeeded') {
  const raw = JSON.stringify({ id, type, data: { object: { metadata: { playerId, productId } } } });
  return { raw, header: stripeSignatureHeader(raw, STRIPE_SECRET) };
}

test('Stripe webhook grants once and is idempotent on replay', async () => {
  const p = await newPlayer('stripe_buyer');
  const { raw, header } = stripeEvent('evt_paid_1', p.id, 'lumen_pouch');

  const first = await api('/api/webhooks/stripe', 'POST', raw, { 'Stripe-Signature': header, 'Content-Type': 'application/json' });
  assert.equal(first.status, 200);
  assert.equal(first.data.granted, 'lumen_pouch');
  assert.equal((await api(`/api/players/${p.id}`)).data.player.wallet.lumen, 50 + 500);

  // Replay the exact same event → deduped, no double-credit.
  const replay = await api('/api/webhooks/stripe', 'POST', raw, { 'Stripe-Signature': header, 'Content-Type': 'application/json' });
  assert.equal(replay.data.duplicate, true);
  assert.equal((await api(`/api/players/${p.id}`)).data.player.wallet.lumen, 50 + 500);
});

test('Stripe webhook rejects a bad signature (400) and ignores unhandled events', async () => {
  const p = await newPlayer('stripe_bad');
  const { raw } = stripeEvent('evt_bad_1', p.id, 'lumen_pouch');
  const bad = await api('/api/webhooks/stripe', 'POST', raw, { 'Stripe-Signature': 't=1,v1=deadbeef', 'Content-Type': 'application/json' });
  assert.equal(bad.status, 400);

  const ignoredRaw = JSON.stringify({ id: 'evt_ignore', type: 'customer.created', data: { object: {} } });
  const ignored = await api('/api/webhooks/stripe', 'POST', ignoredRaw, { 'Stripe-Signature': stripeSignatureHeader(ignoredRaw, STRIPE_SECRET), 'Content-Type': 'application/json' });
  assert.equal(ignored.status, 200);
  assert.equal(ignored.data.ignored, 'customer.created');
});

test('Apple redeem succeeds via the injected transport; a rejected receipt is 402', async () => {
  const p = await newPlayer('apple_buyer');
  const ok = await api(`/api/players/${p.id}/iap/redeem`, 'POST', { platform: 'apple', productId: 'lumen_pouch', transactionId: 'apple-tx-1', receipt: 'good' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.wallet.lumen, 50 + 500);
  const rejected = await api(`/api/players/${p.id}/iap/redeem`, 'POST', { platform: 'apple', productId: 'lumen_pouch', transactionId: 'apple-tx-2', receipt: 'bad' });
  assert.equal(rejected.status, 402);
});

test('the test provider still works alongside real verifiers', async () => {
  const p = await newPlayer('mixed_buyer');
  const r = await api(`/api/players/${p.id}/iap/redeem`, 'POST', {
    platform: 'test', productId: 'lumen_satchel', transactionId: 'mix-1', receipt: testReceipt(IAP_TEST_SECRET, 'lumen_satchel', 'mix-1'),
  });
  assert.equal(r.data.wallet.lumen, 50 + 1200);
});
