// @ts-check
/**
 * Production-hardening tests: confirm the public API returns correct 4xx codes for
 * client mistakes (never 500), resists abuse (body size, faucet farming), sanitises
 * input, and never charges a player for a rejected action.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/api.js';
import { MemoryStore } from '../server/store.js';

let server;
let base;
before(async () => {
  server = createServer(createApp(new MemoryStore()));
  await new Promise((res) => server.listen(0, res));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function api(path, method = 'GET', body, raw) {
  const r = await fetch(base + path, {
    method,
    headers: (body || raw) ? { 'Content-Type': 'application/json' } : undefined,
    body: raw != null ? raw : body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
const newPlayer = async (handle) => (await api('/api/players', 'POST', { handle })).data.player;

test('client faults return 4xx with a typed code, never 500', async () => {
  const p = await newPlayer('hard_a');

  // Plant in plot 0, then a second plant in the same plot must be 400 (not 500).
  const first = await api(`/api/players/${p.id}/garden/plant`, 'POST', { plotIndex: 0, plantId: 'dewbud' });
  assert.equal(first.status, 200);
  const occupied = await api(`/api/players/${p.id}/garden/plant`, 'POST', { plotIndex: 0, plantId: 'dewbud' });
  assert.equal(occupied.status, 400);
  assert.equal(occupied.data.error.code, 'PLOT_OCCUPIED');

  // Harvesting an unripe plot → 400 NOT_READY.
  const notReady = await api(`/api/players/${p.id}/garden/harvest`, 'POST', { plotIndex: 0 });
  assert.equal(notReady.status, 400);
  assert.equal(notReady.data.error.code, 'NOT_READY');

  // Empty plot + out-of-range plot.
  assert.equal((await api(`/api/players/${p.id}/garden/harvest`, 'POST', { plotIndex: 1 })).data.error.code, 'EMPTY_PLOT');
  assert.equal((await api(`/api/players/${p.id}/garden/harvest`, 'POST', { plotIndex: 99 })).data.error.code, 'BAD_PLOT');
});

test('a rejected plant never debits the player', async () => {
  const p = await newPlayer('hard_charge');
  await api(`/api/players/${p.id}/garden/plant`, 'POST', { plotIndex: 0, plantId: 'dewbud' }); // -50
  const afterFirst = (await api(`/api/players/${p.id}`)).data.player.wallet.petals;
  // Second plant on the occupied plot is rejected — wallet must be unchanged.
  await api(`/api/players/${p.id}/garden/plant`, 'POST', { plotIndex: 0, plantId: 'dewbud' });
  const afterReject = (await api(`/api/players/${p.id}`)).data.player.wallet.petals;
  assert.equal(afterReject, afterFirst, 'no charge for a rejected plant');
});

test('request body limits and shape are enforced', async () => {
  const huge = JSON.stringify({ handle: 'x'.repeat(600 * 1024) });
  assert.equal((await api('/api/players', 'POST', undefined, huge)).status, 413);
  // Non-object JSON body is rejected so handlers can trust `body.field`.
  assert.equal((await api('/api/players', 'POST', undefined, '"not-an-object"')).status, 400);
  assert.equal((await api('/api/players', 'POST', undefined, 'not json')).status, 400);
});

test('visit reward cannot be farmed (self-visit blocked, once per neighbour/day)', async () => {
  const a = await newPlayer('hard_visit_a');
  const b = await newPlayer('hard_visit_b');
  assert.equal((await api(`/api/players/${a.id}/visit`, 'POST', { targetId: a.id })).status, 400, 'self-visit blocked');
  const first = await api(`/api/players/${a.id}/visit`, 'POST', { targetId: b.id });
  assert.equal(first.data.reward.petals, 25);
  const second = await api(`/api/players/${a.id}/visit`, 'POST', { targetId: b.id });
  assert.equal(second.data.reward.petals, 0, 'no second reward for the same neighbour today');
  assert.equal(second.data.alreadyVisitedToday, true);
});

test('visit reward is bounded by a daily breadth cap (anti-farm across many ids)', async () => {
  const visitor = await newPlayer('hard_cap_v');
  // Visit 6 distinct neighbours; only the first 5 (the cap) should pay out.
  let rewarded = 0;
  let capped = 0;
  for (let i = 0; i < 6; i++) {
    const target = await newPlayer(`hard_cap_t${i}`);
    const res = await api(`/api/players/${visitor.id}/visit`, 'POST', { targetId: target.id });
    if (res.data.reward.petals === 25) rewarded++;
    if (res.data.dailyCapReached) capped++;
  }
  assert.equal(rewarded, 5, 'exactly the daily cap of distinct visits are rewarded');
  assert.equal(capped, 1, 'further distinct visits hit the cap with no reward');
});

test('preview sanitises input: bad seed code → 400, NaN numerics → default', async () => {
  assert.equal((await api('/api/preview/lumi?seed=LUMI-%21%21%21')).status, 400);
  // A non-numeric bloom must behave exactly like omitting it (no NaN poisoning the roll).
  const withBad = (await api('/api/preview/lumi?seed=12345&bloom=abc')).data.lumi;
  const without = (await api('/api/preview/lumi?seed=12345')).data.lumi;
  assert.equal(withBad.rarity, without.rarity);
  assert.equal(withBad.seedCode, without.seedCode);
});

test('malformed trade offer is a 400, not a server error', async () => {
  const a = await newPlayer('hard_tr_a');
  const b = await newPlayer('hard_tr_b');
  const res = await api(`/api/players/${a.id}/trades`, 'POST', { toId: b.id, offerLumi: 'not-an-array' });
  assert.equal(res.status, 400);
  assert.equal(res.data.error.code, 'BAD_OFFER');
  // Array with a non-string element is also rejected (not iterated as ids).
  const res2 = await api(`/api/players/${a.id}/trades`, 'POST', { toId: b.id, offerLumi: [123] });
  assert.equal(res2.status, 400);
  assert.equal(res2.data.error.code, 'BAD_OFFER');
});

test('unknown routes and missing players return clean 4xx', async () => {
  assert.equal((await api('/api/nope')).status, 404);
  assert.equal((await api('/api/players/00000000-0000-0000-0000-000000000000')).status, 404);
});
