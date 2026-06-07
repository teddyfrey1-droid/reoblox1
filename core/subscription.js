// @ts-check
/**
 * "Golden Garden" subscription logic — recurring, convenience/expression benefits
 * (a daily Lumen stipend, an extra plot, double daily quests). Never power, so it
 * stays non-pay-to-win (docs/06-MONETIZATION.md). Pure & deterministic; `nowMs` is
 * always injected so it's testable and the store stays dumb.
 */

import { IAP_PRODUCTS } from './content.js';
import { dayIndex } from './progression.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fresh subscription state for a new player. */
export function createSubscription() {
  return { tier: null, expiresAt: 0, lastStipendDay: undefined };
}

/** @param {object} sub @param {number} nowMs */
export function isActive(sub, nowMs) {
  return !!sub && !!sub.tier && sub.expiresAt > nowMs;
}

/** Resolve the active subscription's benefits (or null when inactive). */
export function benefits(sub, nowMs) {
  if (!isActive(sub, nowMs)) return null;
  const def = IAP_PRODUCTS[sub.tier];
  return def ? def.benefits : null;
}

/**
 * Extend (or start) a subscription by `days`. Renewals STACK from the later of "now"
 * or the current expiry, so paying again before expiry never loses paid time.
 * @param {object} sub @param {string} tier @param {number} days @param {number} nowMs
 */
export function extend(sub, tier, days, nowMs) {
  const base = Math.max(nowMs, sub.expiresAt || 0);
  sub.tier = tier;
  sub.expiresAt = base + days * DAY_MS;
  return sub;
}

/**
 * Claim the daily Lumen stipend (once per UTC day) when subscribed. Idempotent: a
 * second claim the same day yields 0 (safe for offline/retry).
 * @param {object} sub @param {number} nowMs
 * @returns {{ lumen: number, claimed: boolean }}
 */
export function claimStipend(sub, nowMs) {
  const b = benefits(sub, nowMs);
  if (!b || !b.dailyLumenStipend) return { lumen: 0, claimed: false };
  const today = dayIndex(nowMs);
  if (sub.lastStipendDay === today) return { lumen: 0, claimed: false };
  sub.lastStipendDay = today;
  return { lumen: b.dailyLumenStipend, claimed: true };
}

/** Client-friendly view. */
export function subscriptionView(sub, nowMs) {
  const active = isActive(sub, nowMs);
  return {
    tier: active ? sub.tier : null,
    active,
    expiresAt: sub.expiresAt || 0,
    daysLeft: active ? Math.ceil((sub.expiresAt - nowMs) / DAY_MS) : 0,
    benefits: active ? benefits(sub, nowMs) : null,
    stipendAvailable: active && sub.lastStipendDay !== dayIndex(nowMs),
  };
}
