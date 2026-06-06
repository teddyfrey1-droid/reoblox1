// @ts-check
/**
 * In-app purchase receipt verification — pluggable per platform.
 *
 * SECURITY: purchases are NEVER trusted from the client. The client sends a platform
 * receipt; the server verifies it with the platform before granting anything, and
 * de-duplicates by transaction id so a receipt can't be redeemed twice.
 *
 * This slice ships a `test` verifier (HMAC-signed receipts) that exercises the full
 * redeem→grant→idempotency pipeline deterministically. The apple/google/stripe
 * verifiers are honest stubs: they throw `IAP_PROVIDER_UNAVAILABLE` until real
 * credentials are wired (App Store Server API / Google Play Developer API / Stripe
 * webhook signatures) — we don't ship a fake "always valid" path.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { GameError } from '../core/errors.js';
import { productById } from '../core/content.js';

/** Deterministic test receipt a client/test can produce for the `test` platform. */
export function testReceipt(secret, productId, transactionId) {
  return createHmac('sha256', secret).update(`test:${productId}:${transactionId}`).digest('hex');
}

/**
 * @param {{ testSecret?: string }} [opts]
 * @returns {{ verify: (platform:string, productId:string, transactionId:string, receipt:string) => Promise<{productId:string, transactionId:string}> }}
 */
export function createIapVerifier(opts = {}) {
  async function verify(platform, productId, transactionId, receipt) {
    if (!productById(productId)) throw new GameError('UNKNOWN_PRODUCT', `No product "${productId}"`, 400);
    if (!transactionId || typeof transactionId !== 'string') {
      throw new GameError('BAD_RECEIPT', 'Missing transactionId', 400);
    }
    switch (platform) {
      case 'test': {
        if (!opts.testSecret) throw new GameError('IAP_PROVIDER_UNAVAILABLE', 'Test IAP not enabled', 400);
        const expected = testReceipt(opts.testSecret, productId, transactionId);
        const a = Buffer.from(String(receipt || ''));
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          throw new GameError('BAD_RECEIPT', 'Receipt failed verification', 402);
        }
        return { productId, transactionId };
      }
      case 'apple':
      case 'google':
      case 'stripe':
        // Real verification goes here (App Store Server API / Play Developer API /
        // Stripe signature). Intentionally not faked.
        throw new GameError('IAP_PROVIDER_UNAVAILABLE', `${platform} receipt verification is not configured`, 501);
      default:
        throw new GameError('BAD_PLATFORM', 'platform must be apple|google|stripe|test', 400);
    }
  }
  return { verify };
}
