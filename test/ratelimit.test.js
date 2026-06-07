// @ts-check
/**
 * Rate-limiting tests: the limiter (unit, deterministic clock) and the API enforcing
 * 429 + Retry-After globally, plus a stricter bucket on sensitive endpoints.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/api.js';
import { MemoryStore } from '../server/store.js';
import { createRateLimiter } from '../server/ratelimit.js';

test('limiter allows up to max per window, then denies, then resets', () => {
  let t = 1000;
  const rl = createRateLimiter({ windowMs: 1000, max: 2, now: () => t });
  assert.equal(rl.hit('k').allowed, true);
  assert.equal(rl.hit('k').allowed, true);
  const denied = rl.hit('k');
  assert.equal(denied.allowed, false);
  assert.ok(denied.retryAfterMs > 0 && denied.retryAfterMs <= 1000);
  // Distinct keys are independent.
  assert.equal(rl.hit('other').allowed, true);
  // After the window elapses, the key resets.
  t += 1001;
  assert.equal(rl.hit('k').allowed, true);
});

let server;
let base;
before(async () => {
  server = createServer(createApp(new MemoryStore(), {
    rateLimit: { windowMs: 60_000, max: 5, sensitiveMax: 2 },
  }));
  await new Promise((res) => server.listen(0, res));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const get = (path) => fetch(base + path).then(async (r) => ({ status: r.status, retry: r.headers.get('retry-after') }));

test('global limit returns 429 with Retry-After once exceeded', async () => {
  // max=5 in a 60s window; the 6th request from the same IP is throttled.
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await get('/api/world')).status);
  assert.deepEqual(codes.slice(0, 5), [200, 200, 200, 200, 200]);
  const last = await get('/api/world');
  assert.equal(last.status, 429);
  assert.ok(Number(last.retry) >= 0, 'Retry-After header present');
});

test('sensitive endpoints have a tighter limit', async () => {
  // A fresh server so the global bucket is clean for this IP-key test.
  const srv = createServer(createApp(new MemoryStore(), { rateLimit: { windowMs: 60_000, max: 100, sensitiveMax: 2 } }));
  await new Promise((r) => srv.listen(0, r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  const post = (h) => fetch(`${b}/api/auth/guest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: h }) }).then((r) => r.status);
  try {
    assert.equal(await post('dev-aaaaaaaa'), 200);
    assert.equal(await post('dev-bbbbbbbb'), 200);
    assert.equal(await post('dev-cccccccc'), 429, 'third sensitive call throttled while global limit is far from hit');
  } finally {
    srv.close();
  }
});
