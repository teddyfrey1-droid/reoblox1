// @ts-check
/**
 * Minimal, dependency-free session tokens (HS256 JWTs) using node:crypto.
 *
 * The slice ships an anonymous/guest auth flow (the standard mobile F2P onboarding):
 * a device gets a signed token bound to its player id, and every mutating route
 * checks that the caller's token subject matches the account being acted on — so a
 * client can only ever act on its OWN account. Real Apple/Google sign-in slots in by
 * adding providers to the same identity table; the token format is unchanged.
 *
 * Tokens are standard HS256 JWTs, so they interoperate with off-the-shelf tooling.
 * In production set JWT_SIGNING_KEY so tokens survive restarts and span instances.
 */

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { GameError } from '../core/errors.js';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const b64urlJson = (obj) => b64url(JSON.stringify(obj));
const DEFAULT_TTL_SEC = 30 * 24 * 60 * 60; // 30 days

/**
 * Build an auth helper bound to a signing secret.
 * @param {string} [secret]  HMAC secret; a random one is generated if omitted
 *                           (fine for a single dev process; set JWT_SIGNING_KEY in prod).
 */
export function createAuth(secret) {
  const key = secret || randomBytes(32).toString('hex');
  const ephemeral = !secret;

  /**
   * Sign a token for a player.
   * @param {string} playerId @param {number} [ttlSec]
   */
  function sign(playerId, ttlSec = DEFAULT_TTL_SEC) {
    const now = Math.floor(Date.now() / 1000);
    const header = b64urlJson({ alg: 'HS256', typ: 'JWT' });
    const payload = b64urlJson({ sub: playerId, iat: now, exp: now + ttlSec });
    const data = `${header}.${payload}`;
    const sig = b64url(createHmac('sha256', key).update(data).digest());
    return `${data}.${sig}`;
  }

  /**
   * Verify a token; returns the payload or throws a 401 GameError.
   * @param {string} token
   * @returns {{sub:string, iat:number, exp:number}}
   */
  function verify(token) {
    if (typeof token !== 'string') throw new GameError('BAD_TOKEN', 'Missing token', 401);
    const parts = token.split('.');
    if (parts.length !== 3) throw new GameError('BAD_TOKEN', 'Malformed token', 401);
    const data = `${parts[0]}.${parts[1]}`;
    const expected = createHmac('sha256', key).update(data).digest();
    let got;
    try {
      got = Buffer.from(parts[2], 'base64url');
    } catch {
      throw new GameError('BAD_TOKEN', 'Malformed signature', 401);
    }
    // Constant-time comparison; length check first (timingSafeEqual requires equal length).
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
      throw new GameError('BAD_TOKEN', 'Invalid token signature', 401);
    }
    let payload;
    try {
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      throw new GameError('BAD_TOKEN', 'Malformed payload', 401);
    }
    // Require an expiry and enforce it (defence-in-depth: never honour a no-exp token).
    if (!payload.exp || Math.floor(Date.now() / 1000) > payload.exp) {
      throw new GameError('TOKEN_EXPIRED', 'Session expired', 401);
    }
    if (!payload.sub) throw new GameError('BAD_TOKEN', 'Token missing subject', 401);
    return payload;
  }

  return { sign, verify, ephemeral };
}

/**
 * Extract a Bearer token from a request's Authorization header.
 * @param {import('node:http').IncomingMessage} req
 * @returns {string}
 */
export function bearerToken(req) {
  const h = req.headers['authorization'] || '';
  // RFC 6750: the scheme is case-insensitive; tolerate extra whitespace.
  const m = /^Bearer[ \t]+(.+)$/i.exec((Array.isArray(h) ? h[0] : h).trim());
  if (!m) throw new GameError('NO_TOKEN', 'Authorization: Bearer <token> required', 401);
  return m[1].trim();
}
