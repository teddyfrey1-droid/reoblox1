// @ts-check
/**
 * Static content catalog for LUMORA's MVP vertical slice.
 *
 * This is the "design database": biomes, plant seeds, decor, currencies and the
 * rotating shop. In production this lives in a CMS / remote-config so designers
 * can tune drops and prices without a client build. Here it is plain data so the
 * economy and progression systems can be tested deterministically.
 *
 * Design intent annotations are kept inline so a new team member can understand
 * WHY a value is what it is, not just what it is.
 */

/** The two-currency model. See docs/07-ECONOMY.md for the full sink/source map. */
export const CURRENCIES = {
  // Soft currency. Earned through play. Primary economic loop. Inflation-controlled
  // via decorative & functional sinks (plots, expansions, gacha-light seed packs).
  petals: { id: 'petals', label: 'Petals', premium: false, hardCap: 9_999_999 },
  // Premium currency. Bought or earned slowly. Buys cosmetics, time-skips, battle
  // pass. Never required to progress (no pay-to-win). Soft-capped to discourage hoarding.
  lumen: { id: 'lumen', label: 'Lumen', premium: true, hardCap: 999_999 },
};

/**
 * Biomes a player can unlock for their sky-garden. Each biome biases the element
 * of Lumi born there, giving players a reason to own several (collection strategy)
 * and to visit friends with different biomes (social discovery).
 */
export const BIOMES = [
  { id: 'meadow', label: 'Sunlit Meadow', element: 'bloom', unlock: { petals: 0 }, starter: true },
  { id: 'tide_pools', label: 'Tide Pools', element: 'water', unlock: { petals: 2500 } },
  { id: 'glade', label: 'Mossy Glade', element: 'earth', unlock: { petals: 6000 } },
  { id: 'dunes', label: 'Amber Dunes', element: 'sun', unlock: { petals: 12000 } },
  { id: 'nocturne', label: 'Nocturne Hollow', element: 'moon', unlock: { lumen: 350 } },
  { id: 'emberfall', label: 'Emberfall Ridge', element: 'spark', unlock: { lumen: 600 } },
];

/**
 * Plant seeds. The core "plant → grow → hatch a Lumi" loop runs on these.
 * growMinutes is the real-time-ish grow duration (compressed for the prototype).
 * rarityLuck feeds the genome generator's luck term, so premium/seasonal seeds
 * meaningfully improve the odds of a great Lumi — a clean, non-pay-to-win upsell.
 */
export const PLANTS = [
  { id: 'dewbud', label: 'Dewbud', cost: { petals: 50 }, growMinutes: 5, rarityLuck: 0.0, biomeAffinity: 'meadow' },
  { id: 'tideleaf', label: 'Tideleaf', cost: { petals: 120 }, growMinutes: 12, rarityLuck: 0.05, biomeAffinity: 'tide_pools' },
  { id: 'mosscap', label: 'Mosscap', cost: { petals: 180 }, growMinutes: 20, rarityLuck: 0.08, biomeAffinity: 'glade' },
  { id: 'sunpetal', label: 'Sunpetal', cost: { petals: 260 }, growMinutes: 30, rarityLuck: 0.12, biomeAffinity: 'dunes' },
  { id: 'moonvine', label: 'Moonvine', cost: { lumen: 18 }, growMinutes: 45, rarityLuck: 0.35, biomeAffinity: 'nocturne' },
  { id: 'starbloom', label: 'Starbloom', cost: { lumen: 40 }, growMinutes: 60, rarityLuck: 0.6, seasonal: true },
];

/**
 * Decor items: pure self-expression sinks. They do nothing mechanical, which is
 * exactly the point — cosmetics are the healthiest monetisation/sink because they
 * cost the player nothing in power and cost us nothing in balance.
 */
export const DECOR = [
  { id: 'pebble_path', label: 'Pebble Path', cost: { petals: 80 }, slot: 'ground' },
  { id: 'lantern_post', label: 'Lantern Post', cost: { petals: 220 }, slot: 'prop' },
  { id: 'wind_chime', label: 'Wind Chime', cost: { petals: 340 }, slot: 'prop' },
  { id: 'cloud_bench', label: 'Cloud Bench', cost: { lumen: 60 }, slot: 'prop' },
  { id: 'aurora_arch', label: 'Aurora Arch', cost: { lumen: 220 }, slot: 'feature', premiumOnly: true },
];

/**
 * Daily reward ladder. Escalating value with a "streak" multiplier handled in
 * progression.js. Day 7 intentionally awards premium currency to make the weekly
 * loop feel generous and reduce churn at the one-week cliff.
 */
export const DAILY_REWARDS = [
  { day: 1, petals: 120 },
  { day: 2, petals: 180 },
  { day: 3, petals: 260, seeds: ['dewbud'] },
  { day: 4, petals: 340 },
  { day: 5, petals: 480, seeds: ['tideleaf'] },
  { day: 6, petals: 650 },
  { day: 7, lumen: 60, petals: 800 }, // weekly keystone reward
];

/**
 * XP required to reach each "Keeper Level". Soft, smooth curve: fast early levels
 * for the dopamine of the first session, gently steepening to pace long-term
 * unlocks without a wall. level N requires xpForLevel(N) cumulative XP.
 */
export function xpForLevel(level) {
  // Cumulative XP to *reach* `level` (level 1 = 0).
  if (level <= 1) return 0;
  // ~ quadratic-ish; tuned so L2=80, L5≈900, L10≈4k, L20≈18k.
  return Math.round(40 * (level - 1) * (level - 1) + 40 * (level - 1));
}

/** Unlocks granted at specific Keeper Levels — paces feature reveal (UX onboarding). */
export const LEVEL_UNLOCKS = {
  2: { feature: 'second_plot', note: 'A second garden plot' },
  3: { feature: 'visiting', note: 'Visit neighbours' },
  4: { feature: 'breeding', note: 'The Bloom Ritual (breeding)' },
  5: { feature: 'biome_tide_pools', note: 'Tide Pools biome purchasable' },
  6: { feature: 'constellations', note: 'Join or found a Constellation (guild)' },
  8: { feature: 'trading', note: 'Player-to-player Lumi trading' },
  10: { feature: 'expeditions', note: 'Send Lumi on expeditions' },
};

/** Catalog lookups used by the economy/garden systems. */
export const byId = {
  biome: (id) => BIOMES.find((b) => b.id === id),
  plant: (id) => PLANTS.find((p) => p.id === id),
  decor: (id) => DECOR.find((d) => d.id === id),
};

/**
 * The current "Bloom Pass" (battle pass) track for the active season. 50 tiers,
 * free + premium lanes. Only a representative slice is encoded here; production
 * pulls the full track from remote config.
 */
export const BLOOM_PASS = {
  season: 'S1_FirstLight',
  tiers: 50,
  xpPerTier: 1000,
  // Sampled tiers; free lane stays generous to keep non-payers engaged & retained.
  sample: [
    { tier: 1, free: { petals: 150 }, premium: { lumen: 30 } },
    { tier: 5, free: { decor: 'wind_chime' }, premium: { decor: 'aurora_arch' } },
    { tier: 10, free: { seeds: ['moonvine'] }, premium: { cosmetic: 'lumi_crown' } },
    { tier: 25, free: { petals: 1200 }, premium: { cosmetic: 'biome_skin_nocturne' } },
    { tier: 50, free: { lumen: 120 }, premium: { cosmetic: 'mythic_aura_trail', lumi: 'seasonal_exclusive' } },
  ],
};

/**
 * Real-money store products (validated server-side, see docs/06-MONETIZATION.md).
 * `lumen` products are consumable Lumen packs (with marketing "bonus" baked into the
 * amount); `subscription` is the recurring "Golden Garden" — pure convenience &
 * expression benefits, never power, so it stays non-pay-to-win.
 */
export const IAP_PRODUCTS = {
  lumen_pouch: { id: 'lumen_pouch', kind: 'lumen', lumen: 500, usdCents: 499 },
  lumen_satchel: { id: 'lumen_satchel', kind: 'lumen', lumen: 1200, usdCents: 999 },
  lumen_chest: { id: 'lumen_chest', kind: 'lumen', lumen: 2800, usdCents: 1999 },
  golden_garden: {
    id: 'golden_garden', kind: 'subscription', tier: 'golden_garden',
    durationDays: 30, usdCents: 499,
    benefits: { dailyLumenStipend: 30, extraPlots: 1, doubleQuests: true },
  },
};

/** Lookup helper for store products. */
export const productById = (id) => IAP_PRODUCTS[id] || null;
