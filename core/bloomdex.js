// @ts-check
/**
 * The Bloomdex — LUMORA's living encyclopaedia of discovered Lumi.
 *
 * It turns a pile of creatures into a long-term completion goal (a core retention
 * driver for collection games). It tallies what a player has discovered across the
 * orthogonal axes the generator varies — species (element × form), rarity, and
 * mutation — and reports completion %, plus milestone rewards that fire as the
 * collection deepens.
 *
 * Pure & deterministic: it derives everything from the player's collection, so it
 * needs no extra storage beyond a small "claimed milestones" list.
 */

import { ELEMENTS, FORMS, RARITIES, MUTATIONS } from './genome.js';

/** Total discoverable buckets, derived from the generator's own taxonomy. */
export const BLOOMDEX_TOTALS = {
  species: ELEMENTS.length * FORMS.length, // element × form combinations (36)
  elements: ELEMENTS.length,
  forms: FORMS.length,
  rarities: RARITIES.length,
  mutations: MUTATIONS.length,
};

/**
 * Completion milestones (by % of species discovered). Each grants a one-time
 * reward — generous early to hook completionists, premium at full clear.
 */
export const BLOOMDEX_MILESTONES = [
  { id: 'dex_10', label: 'Budding Keeper', speciesPct: 10, reward: { petals: 500 } },
  { id: 'dex_25', label: 'Curious Keeper', speciesPct: 25, reward: { petals: 1200 } },
  { id: 'dex_50', label: 'Devoted Keeper', speciesPct: 50, reward: { lumen: 60 } },
  { id: 'dex_75', label: 'Master Keeper', speciesPct: 75, reward: { lumen: 120 } },
  { id: 'dex_100', label: 'Luminous Keeper', speciesPct: 100, reward: { lumen: 300, cosmetic: 'bloomdex_crown' } },
];

/**
 * Build a full Bloomdex report for a collection.
 * @param {Array<{element:string, form:string, species:string, rarity:string, mutations:string[]}>} collection
 */
export function bloomdex(collection) {
  const species = new Set();
  const elements = new Set();
  const forms = new Set();
  const rarities = new Set();
  const mutations = new Set();

  for (const l of collection) {
    species.add(`${l.element}:${l.form}`);
    elements.add(l.element);
    forms.add(l.form);
    rarities.add(l.rarity);
    for (const m of l.mutations || []) mutations.add(m);
  }

  const speciesPct = pct(species.size, BLOOMDEX_TOTALS.species);
  const report = {
    discovered: {
      species: species.size,
      elements: elements.size,
      forms: forms.size,
      rarities: rarities.size,
      mutations: mutations.size,
    },
    totals: BLOOMDEX_TOTALS,
    completion: {
      species: speciesPct,
      elements: pct(elements.size, BLOOMDEX_TOTALS.elements),
      forms: pct(forms.size, BLOOMDEX_TOTALS.forms),
      rarities: pct(rarities.size, BLOOMDEX_TOTALS.rarities),
      mutations: pct(mutations.size, BLOOMDEX_TOTALS.mutations),
    },
    // Which milestones the player currently qualifies for (claimed or not).
    milestonesReached: BLOOMDEX_MILESTONES.filter((m) => speciesPct >= m.speciesPct).map((m) => m.id),
    sets: {
      elements: [...elements],
      forms: [...forms],
      rarities: [...rarities],
      mutations: [...mutations],
    },
  };
  return report;
}

/**
 * Given the player's already-claimed milestone ids, return the newly claimable
 * ones plus their total reward (the API grants these and records the ids).
 * @param {string[]} collection
 * @param {string[]} claimed
 */
export function claimableMilestones(collection, claimed) {
  const reached = new Set(bloomdex(collection).milestonesReached);
  const toClaim = BLOOMDEX_MILESTONES.filter((m) => reached.has(m.id) && !claimed.includes(m.id));
  const reward = toClaim.reduce(
    (acc, m) => ({
      petals: acc.petals + (m.reward.petals || 0),
      lumen: acc.lumen + (m.reward.lumen || 0),
      cosmetics: m.reward.cosmetic ? [...acc.cosmetics, m.reward.cosmetic] : acc.cosmetics,
    }),
    { petals: 0, lumen: 0, cosmetics: [] },
  );
  return { milestones: toClaim, reward };
}

function pct(have, total) {
  return total === 0 ? 0 : Math.round((have / total) * 1000) / 10; // one decimal
}
