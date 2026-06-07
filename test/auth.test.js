// @ts-check
/**
 * Authentication tests: token sign/verify (unit) and the enforced auth layer
 * (integration) — no token → 401, wrong account → 403, self → 200, and the
 * guest/device flow recovering the same account.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/api.js';
import { MemoryStore } from '../server/store.js';
import { createAuth } from '../server/auth.js';

/* ------------------------------- unit ------------------------------------ */

test('sign/verify round-trips and binds the subject', () => {
  const auth = createAuth('secret-A');
  const token = auth.sign('player-123');
  const payload = auth.verify(token);
  assert.equal(payload.sub, 'player-123');
  assert.ok(payload.exp > payload.iat);
});

test('a tampered or foreign-signed token is rejected (401)', () => {
  const auth = createAuth('secret-A');
  const other = createAuth('secret-B');
  const token = auth.sign('p1');
  assert.throws(() => other.verify(token), (e) => e.status === 401, 'wrong secret rejected');
  const tampered = token.slice(0, -3) + 'xyz';
  assert.throws(() => auth.verify(tampered), (e) => e.status === 401, 'tampered signature rejected');
  assert.throws(() => auth.verify('garbage'), (e) => e.status === 401);
});

test('an expired token is rejected (401)', () => {
  const auth = createAuth('secret-A');
  const token = auth.sign('p1', -10); // already expired
  assert.throws(() => auth.verify(token), (e) => e.status === 401 && e.code === 'TOKEN_EXPIRED');
});

/* --------------------------- integration --------------------------------- */

let server;
let base;
before(async () => {
  server = createServer(createApp(new MemoryStore(), { requireAuth: true, secret: 'test-secret' }));
  await new Promise((res) => server.listen(0, res));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function api(path, method = 'GET', body, token) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

test('public routes need no token', async () => {
  assert.equal((await api('/api/world')).status, 200);
  assert.equal((await api('/api/catalog')).status, 200);
  assert.equal((await api('/api/preview/lumi?biome=nocturne')).status, 200);
  assert.equal((await api('/api/leaderboard')).status, 200);
});

test('creating a player returns a usable token', async () => {
  const r = await api('/api/players', 'POST', { handle: 'auth_alice' });
  assert.equal(r.status, 200);
  assert.ok(r.data.token, 'token issued on creation');
  // Self access with the token works.
  const self = await api(`/api/players/${r.data.player.id}`, 'GET', undefined, r.data.token);
  assert.equal(self.status, 200);
});

test('per-account routes require a token (401) and reject other accounts (403)', async () => {
  const a = await api('/api/players', 'POST', { handle: 'auth_a' });
  const b = await api('/api/players', 'POST', { handle: 'auth_b' });

  // No token → 401.
  assert.equal((await api(`/api/players/${a.data.player.id}/daily`, 'POST')).status, 401);
  // A's token acting on B's account → 403.
  const cross = await api(`/api/players/${b.data.player.id}/daily`, 'POST', undefined, a.data.token);
  assert.equal(cross.status, 403);
  assert.equal(cross.data.error.code, 'FORBIDDEN');
  // A's token on A's account → 200.
  const ok = await api(`/api/players/${a.data.player.id}/daily`, 'POST', undefined, a.data.token);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.claimed, true);
});

test('guest auth recovers the same account for a returning device', async () => {
  const first = await api('/api/auth/guest', 'POST', { deviceId: 'device-abc12345' });
  assert.equal(first.status, 200);
  assert.equal(first.data.created, true);
  assert.ok(first.data.token && first.data.deviceId === 'device-abc12345');
  // Same device id → same player, fresh token (not a new account).
  const again = await api('/api/auth/guest', 'POST', { deviceId: 'device-abc12345' });
  assert.equal(again.data.created, false);
  assert.equal(again.data.player.id, first.data.player.id);
  // A different (or absent) device id → a different account.
  const other = await api('/api/auth/guest', 'POST', {});
  assert.notEqual(other.data.player.id, first.data.player.id);
  // The guest token actually authorises that guest's account.
  const self = await api(`/api/players/${first.data.player.id}/quests`, 'GET', undefined, first.data.token);
  assert.equal(self.status, 200);
});
