// @ts-check
/**
 * Real-time hub (WebSocket) — presence + live world/social events.
 *
 * Built on the battle-tested `ws` library (an OPTIONAL dependency, lazy-loaded): the
 * framing is `ws`, the hub logic (token auth, presence, channels, broadcast/notify)
 * is ours and unit-tested. Real-time is an enhancement layered on top of the REST
 * API — if `ws` isn't installed the hub degrades to a no-op and the game still runs.
 *
 * Auth: WebSocket clients can't set headers, so the session token is passed as
 * `/ws?token=<jwt>` and verified with the SAME signing key as the REST API (the
 * caller passes a shared `secret`). The connection is bound to that player's id, so
 * personal notifications only ever reach their owner.
 *
 * Channels in this slice:
 *   - world: every client receives live Great-Bloom ticks ({type:'world', ...}).
 *   - player:<id>: personal notifications, e.g. a neighbour visiting you.
 *   - presence: online count broadcast on connect/disconnect.
 */

import { createAuth } from './auth.js';

export function createRealtime({ secret, auth } = {}) {
  const authImpl = auth || createAuth(secret);
  let wss = null;
  /** @type {Set<any>} */ const sockets = new Set();
  /** @type {Map<string, Set<any>>} */ const byPlayer = new Map();

  function track(ws, pid) {
    ws._pid = pid;
    sockets.add(ws);
    if (!byPlayer.has(pid)) byPlayer.set(pid, new Set());
    byPlayer.get(pid).add(ws);
  }
  function untrack(ws) {
    sockets.delete(ws);
    const set = byPlayer.get(ws._pid);
    if (set) { set.delete(ws); if (!set.size) byPlayer.delete(ws._pid); }
  }
  function safeSend(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch { /* socket closing */ } }
  function broadcast(obj) { const s = JSON.stringify(obj); for (const ws of sockets) { try { ws.send(s); } catch { /* */ } } }

  return {
    enabled: false,

    /** Attach to an http.Server: handle WS upgrades on /ws. */
    async attach(server) {
      let WebSocketServer;
      try {
        ({ WebSocketServer } = await import('ws'));
      } catch {
        console.warn('  ⚠ `ws` not installed — real-time disabled (REST API unaffected).');
        return this;
      }
      wss = new WebSocketServer({ noServer: true });
      server.on('upgrade', (req, socket, head) => {
        let url;
        try { url = new URL(req.url || '/', 'http://localhost'); } catch { socket.destroy(); return; }
        if (url.pathname !== '/ws') { socket.destroy(); return; }
        let payload;
        try {
          payload = authImpl.verify(url.searchParams.get('token'));
        } catch {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          track(ws, payload.sub);
          safeSend(ws, { type: 'welcome', playerId: payload.sub, online: sockets.size });
          broadcast({ type: 'presence', online: sockets.size });
          ws.on('message', (data) => {
            let msg;
            try { msg = JSON.parse(data.toString()); } catch { return; }
            if (msg && msg.type === 'ping') safeSend(ws, { type: 'pong', t: Date.now() });
          });
          ws.on('close', () => { untrack(ws); broadcast({ type: 'presence', online: sockets.size }); });
          ws.on('error', () => { /* ignore; close handler cleans up */ });
        });
      });
      this.enabled = true;
      return this;
    },

    /** Live Great-Bloom / world tick to everyone. */
    broadcastWorld(event) { broadcast({ type: 'world', ...event }); },

    /** Personal notification to a specific player's connections (if any). */
    notify(playerId, event) {
      const set = byPlayer.get(playerId);
      if (!set) return;
      const s = JSON.stringify(event);
      for (const ws of set) { try { ws.send(s); } catch { /* */ } }
    },

    onlineCount() { return sockets.size; },

    close() {
      for (const ws of sockets) { try { ws.close(); } catch { /* */ } }
      sockets.clear();
      byPlayer.clear();
      if (wss) wss.close();
    },
  };
}
