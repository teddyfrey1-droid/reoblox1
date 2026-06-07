// @ts-check
/**
 * In-app purchase verification — pluggable per platform.
 *
 * SECURITY: purchases are NEVER trusted from the client. Two real, production-shaped
 * verification paths are implemented here:
 *
 *  - **Stripe** (web shop): server-to-server *webhooks*. `verifyStripeSignature`
 *    implements Stripe's exact scheme — HMAC-SHA256 over `${t}.${rawBody}` compared
 *    in constant time, plus a timestamp tolerance to defeat replay. 100% offline-
 *    verifiable (the handler lives in api.js).
 *  - **Apple / Google** (mobile): client sends a platform receipt; the verifier calls
 *    an INJECTED transport (App Store Server API / Play Developer API in prod; a fake
 *    in tests) and trusts the provider-authoritative product/transaction it returns.
 *
 *  - **test**: HMAC-signed receipts to exercise the full redeem pipeline deterministically.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { GameError } from '../core/errors.js';
import { productById } from '../core/content.js';

/** Constant-time equality for two hex strings (false on length mismatch). */
function safeEqualHex(a, b) {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Deterministic test receipt a client/test can produce for the `test` platform. */
export function testReceipt(secret, productId, transactionId) {
  return createHmac('sha256', secret).update(`test:${productId}:${transactionId}`).digest('hex');
}

/**
 * Verify a Stripe webhook signature (the `Stripe-Signature` header) over the RAW body.
 * Throws a typed 400 on any failure; returns the parsed timestamp on success.
 * @param {string} rawBody  exact bytes Stripe sent
 * @param {string} sigHeader  e.g. "t=1690000000,v1=abcd..."
 * @param {string} secret  webhook signing secret (whsec_...)
 * @param {number} [toleranceSec]
 * @param {number} [nowMs]
 */
export function verifyStripeSignature(rawBody, sigHeader, secret, toleranceSec = 300, nowMs = Date.now()) {
  if (!secret) throw new GameError('STRIPE_NOT_CONFIGURED', 'Stripe webhook secret not configured', 501);
  const parts = String(sigHeader || '').split(',').reduce((acc, kv) => {
    const i = kv.indexOf('=');
    if (i > 0) { const k = kv.slice(0, i).trim(); (acc[k] = acc[k] || []).push(kv.slice(i + 1).trim()); }
    return acc;
  }, /** @type {Record<string,string[]>} */ ({}));
  const t = parts.t && parts.t[0];
  const v1s = parts.v1 || [];
  if (!t || !v1s.length) throw new GameError('BAD_SIGNATURE', 'Malformed Stripe-Signature header', 400);
  // Replay window.
  if (Math.abs(Math.floor(nowMs / 1000) - Number(t)) > toleranceSec) {
    throw new GameError('SIGNATURE_EXPIRED', 'Stripe signature timestamp outside tolerance', 400);
  }
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  if (!v1s.some((v) => safeEqualHex(v, expected))) {
    throw new GameError('BAD_SIGNATURE', 'Stripe signature mismatch', 400);
  }
  return Number(t);
}

/** Build a `Stripe-Signature` header for a payload (used by tests; mirrors Stripe). */
export function stripeSignatureHeader(rawBody, secret, t = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

/**
 * @param {{ testSecret?: string, transport?: { apple?: Function, google?: Function } }} [opts]
 */
export function createIapVerifier(opts = {}) {
  async function verify(platform, productId, transactionId, receipt) {
    if (!productById(productId)) throw new GameError('UNKNOWN_PRODUCT', `No product "${productId}"`, 400);
    if (!transactionId || typeof transactionId !== 'string') {
      throw new GameError('BAD_RECEIPT', 'Missing transactionId', 400);
    }
    if (platform === 'test') {
      if (!opts.testSecret) throw new GameError('IAP_PROVIDER_UNAVAILABLE', 'Test IAP not enabled', 400);
      if (!safeEqualHex(receipt, testReceipt(opts.testSecret, productId, transactionId))) {
        throw new GameError('BAD_RECEIPT', 'Receipt failed verification', 402);
      }
      return { productId, transactionId };
    }
    if (platform === 'apple' || platform === 'google') {
      const fn = opts.transport && opts.transport[platform];
      if (typeof fn !== 'function') {
        throw new GameError('IAP_PROVIDER_UNAVAILABLE', `${platform} receipt verification is not configured`, 501);
      }
      // The transport hits the real provider API (prod) or a fake (tests) and returns
      // the AUTHORITATIVE product/transaction — never trust the client's claims.
      let res;
      try {
        res = await fn({ productId, transactionId, receipt });
      } catch (e) {
        throw new GameError('BAD_RECEIPT', `Provider verification failed: ${e.message}`, 402);
      }
      if (!res || res.ok === false) throw new GameError('BAD_RECEIPT', 'Receipt rejected by provider', 402);
      const vProduct = res.productId || productId;
      if (!productById(vProduct)) throw new GameError('UNKNOWN_PRODUCT', `Provider returned unknown product "${vProduct}"`, 400);
      return { productId: vProduct, transactionId: res.transactionId || transactionId };
    }
    if (platform === 'stripe') {
      throw new GameError('USE_WEBHOOK', 'Stripe purchases are confirmed via the /api/webhooks/stripe webhook', 400);
    }
    throw new GameError('BAD_PLATFORM', 'platform must be apple|google|stripe|test', 400);
  }
  return { verify };
}
