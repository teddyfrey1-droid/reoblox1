// @ts-check
/**
 * Bad-luck protection ("pity") — keeps the variable-reward loop fair.
 *
 * Pure RNG distributions occasionally produce long dry streaks that, for a cozy
 * audience, read as "the game is broken / rigged" and drive churn. A pity system
 * guarantees a minimum rarity after a configurable number of unlucky hatches,
 * then resets. Crucially it is *additive*: most hatches are still pure rolls, so
 * the thrill of an early lucky drop is preserved.
 *
 * It is also fully deterministic & serialisable (a tiny counter object per player),
 * so it round-trips through the store and is unit-testable.
 */

import { RARITIES } from './genome.js';

const ORDER = RARITIES.map((r) => r.id);
const RANK = Object.fromEntries(ORDER.map((id, i) => [id, i]));

/**
 * Thresholds tuned for cozy pacing (gentle, not a hard gacha pity):
 *  - a guaranteed `rare`+ at least every 18 hatches without one,
 *  - a guaranteed `epic`+ at least every 70 hatches without one.
 * These are intentionally generous so the floor rarely fires for an active,
 * well-tended garden (whose luck already lifts the curve) and mainly rescues
 * the genuinely unlucky.
 */
export const PITY = { rareEvery: 18, epicEvery: 70 };

/** Fresh pity state for a new player. */
export function createPity() {
  return { sinceRare: 0, sinceEpic: 0 };
}

/**
 * Compute the rarity floor to apply to the NEXT hatch (or null for a free roll).
 * Evaluated at hatch time so it reflects the player's live dry streak.
 * @param {{sinceRare:number, sinceEpic:number}} pity
 * @returns {string|null}
 */
export function pityFloor(pity) {
  if (pity.sinceEpic + 1 >= PITY.epicEvery) return 'epic';
  if (pity.sinceRare + 1 >= PITY.rareEvery) return 'rare';
  return null;
}

/**
 * Record the outcome of a hatch, resetting/incrementing the dry counters.
 * Hitting `epic`+ satisfies both tracks; hitting `rare`+ satisfies the rare track.
 * @param {{sinceRare:number, sinceEpic:number}} pity
 * @param {string} rarityId
 * @returns {{sinceRare:number, sinceEpic:number}} the same (mutated) object
 */
export function recordHatch(pity, rarityId) {
  const rank = RANK[rarityId] ?? 0;
  if (rank >= RANK.epic) {
    pity.sinceEpic = 0;
    pity.sinceRare = 0;
  } else if (rank >= RANK.rare) {
    pity.sinceRare = 0;
    pity.sinceEpic += 1;
  } else {
    pity.sinceRare += 1;
    pity.sinceEpic += 1;
  }
  return pity;
}
