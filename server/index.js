// @ts-check
/**
 * Server entry point. Boots the HTTP API + static prototype on one port.
 *
 *   npm start            # http://localhost:8787
 *   PORT=3000 npm start
 *
 * Intentionally tiny: all behaviour is in api.js (orchestration) and /core (rules),
 * so this file only wires the network listener and a clean shutdown.
 */

import { createServer } from 'node:http';
import { createApp } from './api.js';
import { MemoryStore } from './store.js';
import { seedDemoWorld } from './scripts/demo.js';

const PORT = Number(process.env.PORT) || 8787;

const store = new MemoryStore();
// Pre-populate a few neighbours + a demo account so the prototype isn't lonely.
const demo = seedDemoWorld(store);

const server = createServer(createApp(store));

server.listen(PORT, () => {
  console.log(`\n  🌱 LUMORA dev server`);
  console.log(`  ─ API + prototype:  http://localhost:${PORT}`);
  console.log(`  ─ Try the generator: http://localhost:${PORT}/api/preview/lumi?biome=nocturne`);
  console.log(`  ─ Demo player id:    ${demo.id} (handle "${demo.handle}")\n`);
});

// Graceful shutdown (clean container teardown / nodemon restarts).
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n  ${sig} received — closing server.`);
    server.close(() => process.exit(0));
  });
}
