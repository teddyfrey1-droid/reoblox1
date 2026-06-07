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
 *   - constellation:<cid>: guild chat — {type:'chat'} in/out, routed to co-members.
 *   - presence: online count broadcast on connect/disconnect.
 */

import { createAuth } from './auth.js';

export function createRealtime({ secret, auth, store } = {}) {
  const authImpl = auth || createAuth(secret);
  let wss = null;
  /** @type {Set<any>} */ const sockets = new Set();
  /** @type {Map<string, Set<any>>} */ const byPlayer = new Map();
  /** @type {Map<string, Set<any>>} constellationId -> sockets (chat rooms) */
  const rooms = new Map();

  function joinRoom(ws, cid) {
    if (!cid || ws._cid === cid) { if (cid) ws._cid = cid; return; }
    if (ws._cid) rooms.get(ws._cid)?.delete(ws);
    ws._cid = cid;
    if (!rooms.has(cid)) rooms.set(cid, new Set());
    rooms.get(cid).add(ws);
  }
  function leaveRoom(ws) {
    if (ws._cid) { const r = rooms.get(ws._cid); if (r) { r.delete(ws); if (!r.size) rooms.delete(ws._cid); } }
  }
  function broadcastRoom(cid, obj) {
    const r = rooms.get(cid); if (!r) return;
    const s = JSON.stringify(obj);
    for (const ws of r) { try { ws.send(s); } catch { /* */ } }
  }

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
        wss.handleUpgrade(req, socket, head, async (ws) => {
          track(ws, payload.sub);
          // Resolve display handle + constellation room for chat (best-effort).
          try {
            const pub = store ? await store.playerPublic(payload.sub) : null;
            ws._handle = (pub && pub.handle) || 'keeper';
            if (pub && pub.constellationId) joinRoom(ws, pub.constellationId);
          } catch { ws._handle = 'keeper'; }
          safeSend(ws, { type: 'welcome', playerId: payload.sub, online: sockets.size });
          broadcast({ type: 'presence', online: sockets.size });
          ws.on('message', (data) => {
            let msg;
            try { msg = JSON.parse(data.toString()); } catch { return; }
            if (!msg) return;
            if (msg.type === 'ping') { safeSend(ws, { type: 'pong', t: Date.now() }); return; }
            if (msg.type === 'chat') {
              if (!ws._cid) { safeSend(ws, { type: 'error', code: 'NO_GUILD', message: 'Join a constellation to chat' }); return; }
              const text = [...String(msg.text || '')].filter((ch) => { const c = ch.charCodeAt(0); return c >= 32 && c !== 127; }).join('').trim().slice(0, 280);
              if (text) broadcastRoom(ws._cid, { type: 'chat', from: ws._handle, text, at: Date.now() });
            }
          });
          ws.on('close', () => { leaveRoom(ws); untrack(ws); broadcast({ type: 'presence', online: sockets.size }); });
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

    /** Move a player's live connections into a constellation chat room (on join/create). */
    setRoom(playerId, constellationId) {
      const set = byPlayer.get(playerId);
      if (!set) return;
      for (const ws of set) joinRoom(ws, constellationId);
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
