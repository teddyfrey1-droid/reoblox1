// @ts-check
/**
 * Real-time tests: token-authenticated WebSocket, presence welcome, live world ticks
 * on hatch/breed, personal visit notifications, and rejection of an invalid token.
 * Skips gracefully if `ws` isn't installed.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/api.js';
import { MemoryStore } from '../server/store.js';
import { createRealtime } from '../server/realtime.js';

let WebSocket;
try { ({ WebSocket } = await import('ws')); } catch { WebSocket = null; }

if (!WebSocket) {
  test('realtime', { skip: '`ws` not installed' }, () => {});
} else {
  const SECRET = 'rt-secret';
  let server;
  let realtime;
  let port;
  const open = [];

  before(async () => {
    const store = new MemoryStore();
    realtime = createRealtime({ secret: SECRET, store }); // share the store for chat routing
    server = createServer(createApp(store, { secret: SECRET, realtime }));
    await new Promise((res) => server.listen(0, res));
    await realtime.attach(server);
    port = server.address().port;
  });
  after(() => {
    for (const ws of open) { try { ws.close(); } catch { /* */ } }
    realtime.close();
    server.close();
  });

  async function api(path, method = 'GET', body, token) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  }

  /** Connect a WS client; resolves with helpers once open, rejects on error. */
  function wsConnect(token) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
      open.push(ws);
      const messages = [];
      let pending = [];
      ws.on('message', (d) => {
        let m; try { m = JSON.parse(d.toString()); } catch { return; }
        messages.push(m);
        pending = pending.filter((w) => { if (w.type === m.type) { w.resolve(m); return false; } return true; });
      });
      ws.on('open', () => resolve({
        ws, messages,
        waitFor(type, timeoutMs = 2000) {
          const found = messages.find((m) => m.type === type);
          if (found) return Promise.resolve(found);
          return new Promise((res, rej) => {
            const to = setTimeout(() => rej(new Error(`timeout waiting for "${type}"`)), timeoutMs);
            pending.push({ type, resolve: (m) => { clearTimeout(to); res(m); } });
          });
        },
      }));
      ws.on('error', reject);
    });
  }

  test('authenticated client receives a welcome bound to its player id', async () => {
    const a = (await api('/api/players', 'POST', { handle: 'rt_welcome' })).data;
    const conn = await wsConnect(a.token);
    const welcome = await conn.waitFor('welcome');
    assert.equal(welcome.playerId, a.player.id);
    assert.ok(welcome.online >= 1);
  });

  test('an invalid token is rejected at the WebSocket handshake', async () => {
    await assert.rejects(wsConnect('not-a-valid-token'), 'bad token must not connect');
  });

  test('a hatch/breed broadcasts a live world tick to connected clients', async () => {
    const a = (await api('/api/players', 'POST', { handle: 'rt_world' })).data;
    const conn = await wsConnect(a.token);
    await conn.waitFor('welcome');
    const coll = (await api(`/api/players/${a.player.id}/collection`, 'GET', undefined, a.token)).data.collection;
    await api(`/api/players/${a.player.id}/breed`, 'POST', { parentA: coll[0].uid, parentB: coll[1].uid }, a.token);
    const world = await conn.waitFor('world');
    assert.equal(typeof world.bloomLevel, 'number');
    assert.equal(typeof world.totalLumiHatched, 'number');
  });

  test('visiting a neighbour pushes them a live notification', async () => {
    const a = (await api('/api/players', 'POST', { handle: 'rt_visitor' })).data;
    const b = (await api('/api/players', 'POST', { handle: 'rt_host' })).data;
    const connB = await wsConnect(b.token);
    await connB.waitFor('welcome');
    await api(`/api/players/${a.player.id}/visit`, 'POST', { targetId: b.player.id }, a.token);
    const visit = await connB.waitFor('visit');
    assert.equal(visit.from, 'rt_visitor');
  });

  test('constellation chat reaches co-members only (room resolved on connect AND via setRoom)', async () => {
    const a = (await api('/api/players', 'POST', { handle: 'chat_a' })).data;
    const b = (await api('/api/players', 'POST', { handle: 'chat_b' })).data;
    const d = (await api('/api/players', 'POST', { handle: 'chat_d' })).data;
    // A founds a guild (then connects → room resolved on connect). D founds another.
    const cid = (await api(`/api/players/${a.player.id}/constellation/create`, 'POST', { name: 'Chat Stars' })).data.constellation.id;
    await api(`/api/players/${d.player.id}/constellation/create`, 'POST', { name: 'Other Stars' });

    const connA = await wsConnect(a.token); await connA.waitFor('welcome');
    const connB = await wsConnect(b.token); await connB.waitFor('welcome');
    const connD = await wsConnect(d.token); await connD.waitFor('welcome');

    // B joins A's guild AFTER connecting → exercises setRoom on a live socket.
    await api(`/api/players/${b.player.id}/constellation/join`, 'POST', { constellationId: cid });

    connA.ws.send(JSON.stringify({ type: 'chat', text: 'hello guild' }));
    const msgB = await connB.waitFor('chat');
    assert.equal(msgB.from, 'chat_a');
    assert.equal(msgB.text, 'hello guild');
    // The other guild must NOT receive it.
    await assert.rejects(connD.waitFor('chat', 400), 'outsider must not receive guild chat');
  });

  test('chat without a guild returns an error, not a broadcast', async () => {
    const solo = (await api('/api/players', 'POST', { handle: 'chat_solo' })).data;
    const conn = await wsConnect(solo.token);
    await conn.waitFor('welcome');
    conn.ws.send(JSON.stringify({ type: 'chat', text: 'anyone?' }));
    const err = await conn.waitFor('error');
    assert.equal(err.code, 'NO_GUILD');
  });
}
