// @ts-check
/**
 * PgStore durability test: runs the API end-to-end against a REAL Postgres engine
 * (PGlite, embedded WASM) and proves that committed state survives a fresh store
 * instance over the same database (true persistence, not in-memory).
 *
 * Gracefully skips if @electric-sql/pglite isn't installed, so the zero-dependency
 * `npm test` still works; CI installs devDependencies and runs it for real.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/api.js';
import { PgStore } from '../server/pgStore.js';
import { pgliteAdapter } from '../server/db.js';
import { testReceipt } from '../server/iap.js';

const IAP_SECRET = 'pg-iap-secret';

// Try to load PGlite + the contrib extensions the schema needs.
let PGlite, citext, pg_trgm;
try {
  ({ PGlite } = await import('@electric-sql/pglite'));
  ({ citext } = await import('@electric-sql/pglite/contrib/citext'));
  ({ pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm'));
} catch {
  PGlite = null;
}

if (!PGlite) {
  test('PgStore persistence', { skip: '@electric-sql/pglite not installed' }, () => {});
} else {
  let pglite;
  let server;
  let base;

  const api = async (path, method = 'GET', body, origin = base) => {
    const r = await fetch(origin + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };

  before(async () => {
    pglite = await PGlite.create({ extensions: { citext, pg_trgm } });
    const store = await new PgStore(pgliteAdapter(pglite)).init();
    server = createServer(createApp(store, { iapTestSecret: IAP_SECRET }));
    await new Promise((res) => server.listen(0, res));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server?.close());

  test('player creation persists across tables (wallet + starter Lumi)', async () => {
    const { status, data } = await api('/api/players', 'POST', { handle: 'pg_alice' });
    assert.equal(status, 200);
    assert.equal(data.player.wallet.petals, 300);
    assert.equal(data.player.wallet.lumen, 50);
    assert.equal(data.player.collectionSize, 2);
    // Read back in a SEPARATE request → must come from Postgres, not request memory.
    const back = await api(`/api/players/${data.player.id}`);
    assert.equal(back.data.player.wallet.lumen, 50);
    assert.equal(back.data.player.collectionSize, 2);
  });

  test('handle uniqueness is enforced by the store', async () => {
    await api('/api/players', 'POST', { handle: 'pg_dup' });
    const dup = await api('/api/players', 'POST', { handle: 'pg_dup' });
    assert.equal(dup.status, 409);
  });

  test('a malformed id is a clean 404, not a Postgres 500 (store parity)', async () => {
    assert.equal((await api('/api/players/not-a-uuid')).status, 404);
    assert.equal((await api('/api/players/not-a-uuid/collection')).status, 404);
    // A non-UUID body field must also 404, not 500.
    const p = (await api('/api/players', 'POST', { handle: 'pg_baduuid' })).data.player;
    assert.equal((await api(`/api/players/${p.id}/visit`, 'POST', { targetId: 'abc' })).status, 404);
  });

  test('daily + quests + bloomdex + breeding persist', async () => {
    const id = (await api('/api/players', 'POST', { handle: 'pg_bob' })).data.player.id;
    assert.equal((await api(`/api/players/${id}/daily`, 'POST')).data.claimed, true);
    assert.equal((await api(`/api/players/${id}/quests`)).data.quests.length, 3);
    assert.ok((await api(`/api/players/${id}/bloomdex`)).data.bloomdex.discovered.species >= 1);

    const coll = (await api(`/api/players/${id}/collection`)).data.collection;
    const breed = await api(`/api/players/${id}/breed`, 'POST', { parentA: coll[0].uid, parentB: coll[1].uid });
    assert.equal(breed.status, 200);
    assert.equal(breed.data.wallet.lumen, 25);

    // Re-fetch (new request): collection grew to 3 and the spend persisted.
    const after = await api(`/api/players/${id}`);
    assert.equal(after.data.player.collectionSize, 3);
    assert.equal(after.data.player.wallet.lumen, 25);
  });

  test('constellations create + join persist (membership reload)', async () => {
    const a = (await api('/api/players', 'POST', { handle: 'pg_guild_a' })).data.player;
    const b = (await api('/api/players', 'POST', { handle: 'pg_guild_b' })).data.player;
    const cid = (await api(`/api/players/${a.id}/constellation/create`, 'POST', { name: 'PG Stars' })).data.constellation.id;
    await api(`/api/players/${b.id}/constellation/join`, 'POST', { constellationId: cid });
    const view = await api(`/api/players/${b.id}/constellation`);
    assert.equal(view.data.constellation.members.length, 2);
  });

  test('atomic trade persists the swap', async () => {
    const a = (await api('/api/players', 'POST', { handle: 'pg_tr_a' })).data.player;
    const b = (await api('/api/players', 'POST', { handle: 'pg_tr_b' })).data.player;
    const aColl = (await api(`/api/players/${a.id}/collection`)).data.collection;
    const bColl = (await api(`/api/players/${b.id}/collection`)).data.collection;
    const created = await api(`/api/players/${a.id}/trades`, 'POST', { toId: b.id, offerLumi: [aColl[0].uid], requestLumi: [bColl[0].uid] });
    assert.equal(created.status, 200);
    const accept = await api(`/api/players/${b.id}/trades/${created.data.trade.id}/accept`, 'POST');
    assert.equal(accept.status, 200);
    const aAfter = (await api(`/api/players/${a.id}/collection`)).data.collection.map((l) => l.uid);
    const bAfter = (await api(`/api/players/${b.id}/collection`)).data.collection.map((l) => l.uid);
    assert.ok(aAfter.includes(bColl[0].uid), 'A received B-0 (persisted)');
    assert.ok(bAfter.includes(aColl[0].uid), 'B received A-0 (persisted)');
  });

  test('IAP receipt dedup is durable (no double-credit across requests)', async () => {
    const id = (await api('/api/players', 'POST', { handle: 'pg_iap' })).data.player.id;
    const before = (await api(`/api/players/${id}`)).data.player.wallet.lumen;
    const body = { platform: 'test', productId: 'lumen_pouch', transactionId: 'pg-tx-1', receipt: testReceipt(IAP_SECRET, 'lumen_pouch', 'pg-tx-1') };
    const first = await api(`/api/players/${id}/iap/redeem`, 'POST', body);
    assert.equal(first.data.wallet.lumen, before + 500);
    // Second redeem in a SEPARATE request: hasReceipt() reads the committed row → no re-credit.
    const second = await api(`/api/players/${id}/iap/redeem`, 'POST', body);
    assert.equal(second.data.alreadyRedeemed, true);
    assert.equal((await api(`/api/players/${id}`)).data.player.wallet.lumen, before + 500);
  });

  test('DURABILITY: state survives a brand-new store over the same database', async () => {
    // Create + mutate a player on the running server.
    const id = (await api('/api/players', 'POST', { handle: 'pg_persist' })).data.player.id;
    const coll = (await api(`/api/players/${id}/collection`)).data.collection;
    await api(`/api/players/${id}/breed`, 'POST', { parentA: coll[0].uid, parentB: coll[1].uid });

    // Spin up a FRESH PgStore + app over the SAME PGlite database (simulates a
    // server restart / a different instance). No data is held in memory here.
    const store2 = await new PgStore(pgliteAdapter(pglite)).init();
    const server2 = createServer(createApp(store2));
    await new Promise((res) => server2.listen(0, res));
    const base2 = `http://127.0.0.1:${server2.address().port}`;
    try {
      const reloaded = await api(`/api/players/${id}`, 'GET', undefined, base2);
      assert.equal(reloaded.status, 200, 'player found by a fresh store instance');
      assert.equal(reloaded.data.player.wallet.lumen, 25, 'Lumen spend persisted across instances');
      assert.equal(reloaded.data.player.collectionSize, 3, 'bred child persisted across instances');
      const dex = await api(`/api/players/${id}/bloomdex`, 'GET', undefined, base2);
      assert.ok(dex.data.bloomdex.discovered.species >= 1, 'collection rehydrated for Bloomdex');
    } finally {
      server2.close();
    }
  });
}
