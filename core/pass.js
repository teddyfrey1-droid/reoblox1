// @ts-check
/**
 * Bloom Pass — the seasonal progression track (battle pass).
 *
 * A free lane that keeps non-payers engaged + a premium lane that is the studio's
 * pillar recurring revenue (see docs/06-MONETIZATION.md). Players earn Pass XP by
 * playing (hatching, quests, events); crossing `xpPerTier` XP advances a tier and
 * unlocks that tier's rewards to claim.
 *
 * Pure & deterministic. Reward content comes from core/content.js#BLOOM_PASS so the
 * design (and tests) read from a single source of truth.
 */

import { BLOOM_PASS } from './content.js';

/** Fresh per-player pass state for the active season. */
export function createPassState(season = BLOOM_PASS.season) {
  return { season, xp: 0, premium: false, claimedFree: [], claimedPremium: [] };
}

/** Current tier from accumulated Pass XP (capped at the season's tier count). */
export function tierFromXp(xp) {
  return Math.min(BLOOM_PASS.tiers, Math.floor(xp / BLOOM_PASS.xpPerTier));
}

/**
 * Add Pass XP, returning the new state plus how many tiers were crossed (for the
 * celebratory "tier up!" UI). Does not auto-claim — claiming is an explicit action
 * so the player sees each reward.
 * @param {object} state
 * @param {number} amount
 */
export function addPassXp(state, amount) {
  const beforeTier = tierFromXp(state.xp);
  state.xp += Math.max(0, amount);
  const afterTier = tierFromXp(state.xp);
  return { state, tier: afterTier, tiersGained: afterTier - beforeTier };
}

/**
 * List reward-bearing tiers the player has reached but not yet claimed, split by
 * lane. Only tiers present in BLOOM_PASS.sample carry rewards in this slice (the
 * full 50-tier track is remote-config in production).
 * @param {object} state
 */
export function claimableTiers(state) {
  const tier = tierFromXp(state.xp);
  const free = BLOOM_PASS.sample
    .filter((t) => t.tier <= tier && t.free && !state.claimedFree.includes(t.tier))
    .map((t) => ({ tier: t.tier, lane: 'free', reward: t.free }));
  const premium = state.premium
    ? BLOOM_PASS.sample
        .filter((t) => t.tier <= tier && t.premium && !state.claimedPremium.includes(t.tier))
        .map((t) => ({ tier: t.tier, lane: 'premium', reward: t.premium }))
    : [];
  return [...free, ...premium];
}

/**
 * Mark a tier+lane claimed and return its reward (idempotent: re-claiming yields
 * null). The API translates currency rewards into wallet grants.
 * @param {object} state
 * @param {number} tier
 * @param {'free'|'premium'} lane
 */
export function claimTier(state, tier, lane) {
  const reachable = tierFromXp(state.xp) >= tier;
  if (!reachable) throw new Error('Tier not yet reached');
  if (lane === 'premium' && !state.premium) throw new Error('Premium pass not owned');
  const entry = BLOOM_PASS.sample.find((t) => t.tier === tier);
  const reward = entry && entry[lane];
  if (!reward) return null;
  const claimedList = lane === 'premium' ? state.claimedPremium : state.claimedFree;
  if (claimedList.includes(tier)) return null; // already claimed
  claimedList.push(tier);
  return reward;
}

/** Buy the premium lane (the API charges Lumen before calling this). */
export function upgradeToPremium(state) {
  state.premium = true;
  return state;
}

/** A compact, client-friendly view of pass progress. */
export function passView(state) {
  const tier = tierFromXp(state.xp);
  return {
    season: state.season,
    tier,
    maxTier: BLOOM_PASS.tiers,
    xp: state.xp,
    xpPerTier: BLOOM_PASS.xpPerTier,
    xpIntoTier: state.xp - tier * BLOOM_PASS.xpPerTier,
    premium: state.premium,
    claimable: claimableTiers(state).length,
  };
}
