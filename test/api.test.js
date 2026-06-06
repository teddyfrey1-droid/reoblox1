// @ts-check
/**
 * In-process API integration test: boots the real HTTP server on an ephemeral port
 * (in-memory store) and exercises the end-to-end flows that the unit tests can't —
 * routing, validation, currency side-effects, breeding, Bloomdex, Bloom Pass,
 * constellations and an atomic player-to-player trade.
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

async function api(path, method = 'GET', body) {
  const r = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

test('player creation grants onboarding bundle (currency + starter Lumi + pass)', async () => {
  const { status, data } = await api('/api/players', 'POST', { handle: 'alice_test' });
  assert.equal(status, 200);
  assert.equal(data.player.wallet.petals, 300);
  assert.equal(data.player.wallet.lumen, 50);
  assert.equal(data.player.collectionSize, 2);
  assert.equal(data.player.pass.tier, 0);
});

test('bad handle is rejected with 400', async () => {
  const { status } = await api('/api/players', 'POST', { handle: 'x' });
  assert.equal(status, 400);
});

test('daily, quests, bloomdex and breeding work end-to-end', async () => {
  const { data: { player } } = await api('/api/players', 'POST', { handle: 'bob_test' });
  const id = player.id;

  const daily = await api(`/api/players/${id}/daily`, 'POST');
  assert.equal(daily.data.claimed, true);

  const quests = await api(`/api/players/${id}/quests`);
  assert.equal(quests.data.quests.length, 3);

  const dex = await api(`/api/players/${id}/bloomdex`);
  assert.ok(dex.data.bloomdex.discovered.species >= 1);

  // Breed the two starter Lumi (player has 50 Lumen; ritual costs 25).
  const coll = (await api(`/api/players/${id}/collection`)).data.collection;
  const breed = await api(`/api/players/${id}/breed`, 'POST', { parentA: coll[0].uid, parentB: coll[1].uid });
  assert.equal(breed.status, 200);
  assert.equal(breed.data.wallet.lumen, 25);
  assert.equal(breed.data.child.lineage.length, 2);
  // Breeding awarded Pass XP via onHatch.
  const pass = await api(`/api/players/${id}/pass`);
  assert.ok(pass.data.pass.xp >= 120);
});

test('constellations: create and join', async () => {
  const a = (await api('/api/players', 'POST', { handle: 'guild_a' })).data.player;
  const b = (await api('/api/players', 'POST', { handle: 'guild_b' })).data.player;
  const created = await api(`/api/players/${a.id}/constellation/create`, 'POST', { name: 'Test Stars' });
  assert.equal(created.status, 200);
  const cid = created.data.constellation.id;
  const joined = await api(`/api/players/${b.id}/constellation/join`, 'POST', { constellationId: cid });
  assert.equal(joined.data.constellation.members, 2);
});

test('atomic trade swaps Lumi between two players', async () => {
  const a = (await api('/api/players', 'POST', { handle: 'trader_a' })).data.player;
  const b = (await api('/api/players', 'POST', { handle: 'trader_b' })).data.player;
  const aColl = (await api(`/api/players/${a.id}/collection`)).data.collection;
  const bColl = (await api(`/api/players/${b.id}/collection`)).data.collection;

  const created = await api(`/api/players/${a.id}/trades`, 'POST', {
    toId: b.id, offerLumi: [aColl[0].uid], requestLumi: [bColl[0].uid],
  });
  assert.equal(created.status, 200);
  assert.ok(created.data.tax > 0);

  const accept = await api(`/api/players/${b.id}/trades/${created.data.trade.id}/accept`, 'POST');
  assert.equal(accept.status, 200);

  // Verify the swap landed in both collections.
  const aAfter = (await api(`/api/players/${a.id}/collection`)).data.collection.map((l) => l.uid);
  const bAfter = (await api(`/api/players/${b.id}/collection`)).data.collection.map((l) => l.uid);
  assert.ok(aAfter.includes(bColl[0].uid), 'A received B-0');
  assert.ok(bAfter.includes(aColl[0].uid), 'B received A-0');
});

test('locking a Lumi blocks it from being offered in a trade', async () => {
  const a = (await api('/api/players', 'POST', { handle: 'lock_a' })).data.player;
  const b = (await api('/api/players', 'POST', { handle: 'lock_b' })).data.player;
  const aColl = (await api(`/api/players/${a.id}/collection`)).data.collection;
  await api(`/api/players/${a.id}/lumi/${aColl[0].uid}/lock`, 'POST', { locked: true });
  const created = await api(`/api/players/${a.id}/trades`, 'POST', { toId: b.id, offerLumi: [aColl[0].uid] });
  assert.equal(created.status, 400);
  assert.equal(created.data.error.code, 'LOCKED');
});
