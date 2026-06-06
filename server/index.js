// @ts-check
/**
 * Server entry point. Boots the HTTP API + static prototype on one port.
 *
 *   npm start                              # in-memory store, demo world (zero infra)
 *   PORT=3000 npm start
 *   DATABASE_URL=postgres://… npm start    # durable PostgreSQL store (needs `pg`)
 *
 * Store selection is the only branch here; all behaviour lives in api.js
 * (orchestration) and /core (rules).
 */

import { createServer } from 'node:http';
import { createApp } from './api.js';
import { MemoryStore } from './store.js';
import { seedDemoWorld } from './scripts/demo.js';

const PORT = Number(process.env.PORT) || 8787;

let store;
let demoNote = '';

if (process.env.DATABASE_URL) {
  // Durable mode: Postgres-backed store (data survives restarts). `pg` is lazy-imported.
  const { PgStore } = await import('./pgStore.js');
  const { openPostgres } = await import('./db.js');
  const db = await openPostgres(process.env.DATABASE_URL);
  store = await new PgStore(db).init();
  demoNote = '  ─ Store:             PostgreSQL (durable)\n';
} else {
  // Zero-infra mode: in-memory store with a pre-seeded demo world so the prototype
  // isn't lonely on first load.
  store = new MemoryStore();
  const demo = seedDemoWorld(store);
  demoNote = `  ─ Store:             in-memory (set DATABASE_URL for durable Postgres)\n  ─ Demo player id:    ${demo.id} (handle "${demo.handle}")\n`;
}

// Auth is enforced in the running server. Set JWT_SIGNING_KEY so tokens survive
// restarts and span instances; without it we use a random per-process key (dev only).
if (!process.env.JWT_SIGNING_KEY) {
  console.warn('  ⚠ JWT_SIGNING_KEY not set — using an ephemeral key (tokens reset on restart).');
}
const server = createServer(createApp(store, { requireAuth: true, secret: process.env.JWT_SIGNING_KEY }));

server.listen(PORT, () => {
  console.log('\n  🌱 LUMORA dev server');
  console.log(`  ─ API + prototype:  http://localhost:${PORT}`);
  console.log(`  ─ Try the generator: http://localhost:${PORT}/api/preview/lumi?biome=nocturne`);
  console.log('  ─ Auth:             Bearer tokens required on per-account routes');
  process.stdout.write(demoNote + '\n');
});

// Graceful shutdown (clean container teardown / nodemon restarts).
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n  ${sig} received — closing server.`);
    server.close(() => process.exit(0));
  });
}
