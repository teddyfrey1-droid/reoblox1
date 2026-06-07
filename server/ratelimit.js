// @ts-check
/**
 * Fixed-window rate limiter (in-memory, deterministic).
 *
 * Protects the public API from hammering/abuse — especially the sensitive endpoints
 * (auth/guest, account creation, IAP redeem). Deterministic (injectable clock) so it
 * is unit-testable. Per-process; at multi-instance scale this moves to a shared store
 * (Redis INCR with EXPIRE) behind the same interface — documented in docs/11.
 *
 * Disabled by default in createApp (so tests/dev aren't throttled); the running
 * server enables it with sensible limits.
 */

export function createRateLimiter({ windowMs = 60_000, max = 300, now = Date.now } = {}) {
  /** @type {Map<string, { count: number, reset: number }>} */
  const buckets = new Map();

  /**
   * Account for one request against `key`.
   * @param {string} key
   * @returns {{ allowed: boolean, remaining: number, retryAfterMs: number }}
   */
  function hit(key) {
    const t = now();
    let b = buckets.get(key);
    if (!b || t >= b.reset) { b = { count: 0, reset: t + windowMs }; buckets.set(key, b); }
    b.count += 1;
    // Opportunistic sweep so memory can't grow unbounded with one-off keys.
    if (buckets.size > 50_000) for (const [k, v] of buckets) if (t >= v.reset) buckets.delete(k);
    const allowed = b.count <= max;
    return { allowed, remaining: Math.max(0, max - b.count), retryAfterMs: allowed ? 0 : b.reset - t };
  }

  return { hit, windowMs, max, size: () => buckets.size };
}
