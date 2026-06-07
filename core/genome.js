// @ts-check
/**
 * LUMI GENOME — the signature generative-creature system of LUMORA.
 * =================================================================
 *
 * A "Lumi" is a companion creature that is BORN from a garden. Instead of being
 * hand-authored or drawn from a fixed gacha pool, every Lumi is generated
 * deterministically from a 32-bit seed plus the conditions of the garden it grew
 * in. This gives us:
 *
 *   - Near-infinite variety (collection depth → long-term retention).
 *   - Determinism (same inputs → same Lumi everywhere → server-authoritative,
 *     shareable "seed codes", fully unit-testable, anti-cheat friendly).
 *   - Breeding/combination (two parents + a garden → child) which creates an
 *     emergent trading economy and "look what I made" virality.
 *   - A render spec (pure data) so any client can draw the creature with vector
 *     art — no asset downloads, no art bottleneck.
 *
 * The genome is intentionally a plain serialisable object. The same module runs
 * in Node (server, authoritative) and in the browser (instant client preview),
 * which is why it has zero dependencies beyond ./rng.js.
 */

import { Rng, mixSeeds, toUint32, hashString } from './rng.js';

/**
 * Rarity tiers and their base weights. Tuned so that the "chase" tiers are rare
 * enough to feel special but common enough that an engaged player sees one in a
 * reasonable session (drives the variable-reward loop without feeling rigged).
 * Weights are relative; they are re-normalised at roll time.
 */
export const RARITIES = [
  { id: 'common', label: 'Common', weight: 1000, statMul: 1.0, glow: 0.0 },
  { id: 'uncommon', label: 'Uncommon', weight: 420, statMul: 1.12, glow: 0.1 },
  { id: 'rare', label: 'Rare', weight: 150, statMul: 1.28, glow: 0.25 },
  { id: 'epic', label: 'Epic', weight: 42, statMul: 1.5, glow: 0.45 },
  { id: 'legendary', label: 'Legendary', weight: 9, statMul: 1.8, glow: 0.7 },
  { id: 'mythic', label: 'Mythic', weight: 1.2, statMul: 2.2, glow: 1.0 },
];

/** Elemental affinities. Drive palette bias, particle FX and light "type" synergy. */
export const ELEMENTS = [
  { id: 'sun', label: 'Sun', hue: 45, accentHue: 18 },
  { id: 'moon', label: 'Moon', hue: 235, accentHue: 280 },
  { id: 'water', label: 'Water', hue: 195, accentHue: 165 },
  { id: 'earth', label: 'Earth', hue: 110, accentHue: 35 },
  { id: 'spark', label: 'Spark', hue: 320, accentHue: 290 },
  { id: 'bloom', label: 'Bloom', hue: 340, accentHue: 110 },
];

/** Body archetypes. Determine silhouette and how the render spec is assembled. */
export const FORMS = [
  { id: 'sprout', label: 'Sprout', weight: 30, baseSize: 0.9, legs: 0 },
  { id: 'critter', label: 'Critter', weight: 26, baseSize: 1.0, legs: 4 },
  { id: 'floater', label: 'Floater', weight: 18, baseSize: 1.05, legs: 0 },
  { id: 'finling', label: 'Finling', weight: 14, baseSize: 0.95, legs: 0 },
  { id: 'tot', label: 'Tot', weight: 9, baseSize: 0.85, legs: 2 },
  { id: 'wyrm', label: 'Wyrm', weight: 3, baseSize: 1.2, legs: 0 },
];

/** Coat patterns layered over the base palette. */
export const PATTERNS = ['solid', 'spots', 'stripes', 'gradient', 'speckle', 'patch'];

/** Personality archetypes — drive idle animation, blink rate and dialogue tone. */
export const TEMPERAMENTS = [
  'cheerful', 'shy', 'curious', 'sleepy', 'brave', 'mischievous', 'serene', 'dramatic',
];

/**
 * Rare cosmetic mutations. Each is an independent low-probability roll and is what
 * the hardcore collectors chase. Probabilities are deliberately small; a few are
 * gated behind higher rarity so a "Mythic Aurora Lumi" is genuinely a trophy.
 */
export const MUTATIONS = [
  { id: 'aurora', label: 'Aurora Coat', p: 0.012 },
  { id: 'crystalline', label: 'Crystalline', p: 0.02 },
  { id: 'starlit', label: 'Starlit Eyes', p: 0.03 },
  { id: 'twin_tail', label: 'Twin Tail', p: 0.04 },
  { id: 'halo', label: 'Halo', p: 0.015, minRarity: 'epic' },
  { id: 'ember_heart', label: 'Ember Heart', p: 0.025 },
  { id: 'albino', label: 'Albino', p: 0.008 },
  { id: 'melanistic', label: 'Melanistic', p: 0.01 },
];

const RARITY_ORDER = RARITIES.map((r) => r.id);

const SYL_HEAD = ['lu', 'mi', 'po', 'fae', 'sol', 'nyx', 'tib', 'oro', 'vee', 'zib', 'qua', 'mo'];
const SYL_TAIL = ['mo', 'ra', 'lo', 'ki', 'na', 'pip', 'dle', 'sy', 'won', 'bo', 'fen', 'lux'];

/**
 * Garden context that biases a newborn Lumi. All fields optional; sensible
 * defaults keep the generator usable standalone (and testable).
 * @typedef {Object} GardenContext
 * @property {string} [biome]            One of the content biome ids; biases element.
 * @property {number} [bloomLevel]       0..100 community/world bloom; nudges rarity up.
 * @property {string} [season]           'spring'|'summer'|'autumn'|'winter'; tints palette.
 * @property {number} [careQuality]      0..1 how well the parent garden was tended; nudges stats & rarity.
 * @property {string} [plantSpecies]     The plant the seed grew from; biases form.
 * @property {string} [rarityFloor]      Optional guaranteed minimum rarity (pity/bad-luck protection).
 */

/**
 * Resolve a weighted rarity, with positive modifiers folded in.
 * Higher world bloom and better care quality gently shift the distribution toward
 * rarer tiers — this is the core "tend your garden → better creatures" incentive.
 * @param {Rng} r
 * @param {number} luck  additive multiplier on rare-tier weights (0 = neutral)
 */
function rollRarity(r, luck) {
  const entries = RARITIES.map((tier, idx) => {
    // luck lifts the upper tiers multiplicatively; common is untouched.
    const lift = idx === 0 ? 1 : 1 + luck * (idx / (RARITIES.length - 1));
    return { value: tier, weight: tier.weight * lift };
  });
  return r.weighted(entries);
}

/**
 * Bias element selection by biome/season so worlds feel coherent, while still
 * allowing any element to appear (no hard gates → keeps trading liquid).
 * @param {Rng} r
 * @param {GardenContext} ctx
 */
function rollElement(r, ctx) {
  const biomeBias = {
    meadow: 'bloom', dunes: 'sun', tide_pools: 'water',
    glade: 'earth', nocturne: 'moon', emberfall: 'spark',
  };
  const seasonBias = { spring: 'bloom', summer: 'sun', autumn: 'earth', winter: 'moon' };
  const entries = ELEMENTS.map((e) => {
    let w = 10;
    if (biomeBias[ctx.biome] === e.id) w += 22;
    if (seasonBias[ctx.season] === e.id) w += 8;
    return { value: e, weight: w };
  });
  return r.weighted(entries);
}

/**
 * Convert HSL to a hex string (render spec is resolution-independent vector art,
 * but a hex palette is convenient for clients and for previews/snapshots).
 * @param {number} h 0..360 @param {number} s 0..1 @param {number} l 0..1
 */
export function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rp = 0, gp = 0, bp = 0;
  if (h < 60) [rp, gp, bp] = [c, x, 0];
  else if (h < 120) [rp, gp, bp] = [x, c, 0];
  else if (h < 180) [rp, gp, bp] = [0, c, x];
  else if (h < 240) [rp, gp, bp] = [0, x, c];
  else if (h < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(rp)}${to(gp)}${to(bp)}`;
}

/**
 * Build a small palette around an element with controlled, pleasing variation.
 * Uses analogous + accent harmony so randomly generated creatures still look
 * art-directed rather than noisy.
 * @param {Rng} r
 * @param {{hue:number, accentHue:number}} element
 * @param {string|undefined} season
 * @param {{albino:boolean, melanistic:boolean, aurora:boolean}} flags
 */
function buildPalette(r, element, season, flags) {
  const seasonShift = { spring: 6, summer: -4, autumn: 18, winter: -10 }[season] || 0;
  const baseHue = element.hue + r.float(-14, 14) + seasonShift;
  let sat = r.float(0.45, 0.78);
  let light = r.float(0.5, 0.68);
  if (flags.albino) { sat = r.float(0.05, 0.14); light = r.float(0.82, 0.92); }
  if (flags.melanistic) { sat = r.float(0.3, 0.5); light = r.float(0.16, 0.26); }

  const primary = hslToHex(baseHue, sat, light);
  const secondary = hslToHex(baseHue + r.float(18, 40), sat * 0.9, light - 0.12);
  const accent = hslToHex(element.accentHue + r.float(-10, 10), Math.min(1, sat + 0.15), Math.min(0.7, light + 0.06));
  const belly = hslToHex(baseHue, sat * 0.4, Math.min(0.95, light + 0.22));

  return {
    primary,
    secondary,
    accent,
    belly,
    // Aurora coat = animated multi-stop gradient; we expose extra stops for the renderer.
    aurora: flags.aurora
      ? [hslToHex(baseHue, sat, light), hslToHex(baseHue + 80, sat, light), hslToHex(baseHue + 160, sat, light)]
      : null,
  };
}

/**
 * Roll independent cosmetic mutations.
 * @param {Rng} r
 * @param {string} rarityId
 * @param {number} mutationBoost additive probability multiplier (events can raise this)
 */
function rollMutations(r, rarityId, mutationBoost) {
  const rarityIdx = RARITY_ORDER.indexOf(rarityId);
  /** @type {string[]} */
  const out = [];
  for (const m of MUTATIONS) {
    if (m.minRarity && RARITY_ORDER.indexOf(m.minRarity) > rarityIdx) continue;
    if (r.chance(m.p * (1 + mutationBoost))) out.push(m.id);
  }
  return out;
}

/**
 * Generate a pronounceable, deterministic default name.
 * @param {Rng} r
 */
function rollName(r) {
  const a = r.pick(SYL_HEAD);
  const b = r.pick(SYL_TAIL);
  const name = (a + b).replace(/(.)\1{2,}/g, '$1$1');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Compute the four light gameplay stats. Stats are cosmetic-adjacent: they gate
 * cute "talents" (e.g. a high-Harmony Lumi speeds nearby plant growth) but are
 * deliberately low-stakes so the game never becomes pay-to-win.
 * @param {Rng} r
 * @param {number} statMul rarity multiplier
 * @param {number} careQuality 0..1
 */
function rollStats(r, statMul, careQuality) {
  const base = () => Math.round((r.int(8, 16) + careQuality * 6) * statMul);
  return {
    charm: base(),   // social value, photo score, trade desirability
    vigor: base(),   // stamina for expeditions / play
    harmony: base(), // garden growth bonus aura
    spark: base(),   // event/minigame performance
  };
}

/**
 * THE core entry point: derive a complete Lumi genome from a seed + garden context.
 *
 * @param {number|string} seed  32-bit int or string seed code (string is hashed).
 * @param {GardenContext} [ctx]
 * @returns {Genome}
 */
export function generateLumi(seed, ctx = {}) {
  const numericSeed = typeof seed === 'string' ? hashString(seed) : toUint32(seed);
  const r = new Rng(numericSeed);

  const bloom = clamp01((ctx.bloomLevel ?? 0) / 100);
  const care = clamp01(ctx.careQuality ?? 0.5);
  // Luck for rarity: world bloom contributes up to +1.5x lift, care up to +0.8x.
  const luck = bloom * 1.5 + care * 0.8;
  let rarity = rollRarity(r, luck);
  // Bad-luck protection: the pity system (core/luck.js) may pass a rarity floor that
  // guarantees a minimum tier without otherwise distorting the roll. This keeps the
  // variable-reward loop exciting while preventing the "100 commons in a row" churn.
  if (ctx.rarityFloor) {
    const floorIdx = RARITY_ORDER.indexOf(ctx.rarityFloor);
    const rolledIdx = RARITY_ORDER.indexOf(rarity.id);
    if (floorIdx > 0 && floorIdx > rolledIdx) rarity = RARITIES[floorIdx];
  }

  const element = rollElement(r, ctx);
  const form = r.weighted(FORMS.map((f) => ({ value: f, weight: f.weight })));
  const pattern = r.pick(PATTERNS);
  const temperament = r.pick(TEMPERAMENTS);

  const mutations = rollMutations(r, rarity.id, bloom * 0.6);
  const flags = {
    albino: mutations.includes('albino'),
    melanistic: mutations.includes('melanistic'),
    aurora: mutations.includes('aurora'),
  };

  const palette = buildPalette(r, element, ctx.season, flags);
  const stats = rollStats(r, rarity.statMul, care);

  const size = +(form.baseSize * r.float(0.86, 1.14)).toFixed(3);
  const eyeCount = mutations.includes('starlit') ? r.int(2, 3) : 2;

  /** @type {Genome} */
  const genome = {
    schema: 1,
    seed: numericSeed,
    seedCode: encodeSeedCode(numericSeed),
    name: rollName(r),
    species: `${element.label} ${form.label}`,
    rarity: rarity.id,
    element: element.id,
    form: form.id,
    pattern,
    temperament,
    size,
    eyeCount,
    mutations,
    glow: +(rarity.glow + (flags.aurora ? 0.2 : 0)).toFixed(3),
    palette,
    stats,
    // A compact, renderer-agnostic spec. Any client can draw the Lumi from this
    // without downloading art assets.
    render: buildRenderSpec(r, { form, pattern, palette, size, eyeCount, mutations, glow: rarity.glow }),
    // Power score = single comparable number for sorting/trade valuation/leaderboards.
    power: stats.charm + stats.vigor + stats.harmony + stats.spark,
    lineage: ctx.parentIds ? ctx.parentIds.slice(0, 2) : [],
    bornFrom: {
      biome: ctx.biome ?? null,
      season: ctx.season ?? null,
      plantSpecies: ctx.plantSpecies ?? null,
      bloomLevel: ctx.bloomLevel ?? null,
    },
  };
  return genome;
}

/**
 * Renderer-agnostic vector spec. The web prototype interprets this with <canvas>;
 * the production client (Unity/Godot) would map the same fields to bones/sprites.
 */
function buildRenderSpec(r, { form, pattern, palette, size, eyeCount, mutations, glow }) {
  return {
    body: {
      shape: form.legs > 0 ? 'rounded' : 'blob',
      legs: form.legs,
      wobble: +r.float(0.04, 0.12).toFixed(3),
      size,
      // Form id + silhouette hints let any renderer give each archetype a distinct
      // outline instead of "same blob, different colour" (key to perceived variety).
      form: form.id,
      elongate: form.id === 'wyrm' ? 1.55 : 1,
      hover: form.id === 'floater' ? 0.22 : 0, // floaters sit higher off the ground
    },
    appendages: {
      fins: form.id === 'finling',     // side + tail fins
      leaf: form.id === 'sprout',      // a sprouting stem/leaf on top
      ears: form.id === 'critter',     // rounded ears
      wings: form.id === 'floater',    // little hovering wings
      arms: form.id === 'tot',         // tiny arms (bipedal)
      antenna: form.id === 'wyrm',     // a curious antenna
    },
    coat: {
      pattern,
      spots: pattern === 'spots' || pattern === 'speckle' ? r.int(4, 14) : 0,
      stripes: pattern === 'stripes' ? r.int(3, 7) : 0,
    },
    eyes: {
      count: eyeCount,
      size: +r.float(0.16, 0.26).toFixed(3),
      sparkle: mutations.includes('starlit'),
    },
    extras: {
      halo: mutations.includes('halo'),
      crystalline: mutations.includes('crystalline'),
      twinTail: mutations.includes('twin_tail'),
      emberHeart: mutations.includes('ember_heart'),
    },
    aura: { glow, color: palette.accent },
    palette,
  };
}

/**
 * BREEDING / COMBINATION.
 * Two parent genomes plus a garden context yield a child. The child seed is a
 * deterministic mix of the parents' seeds and a "ritual" entropy value (the
 * server supplies a fresh value; clients can preview with a guessed one). Traits
 * are inherited with mutation, so lineages drift and "perfecting a line" becomes
 * a long-term goal — the backbone of the player-driven economy.
 *
 * @param {Genome} a
 * @param {Genome} b
 * @param {GardenContext & {ritualSeed?: number}} ctx
 * @returns {Genome}
 */
export function breedLumi(a, b, ctx = {}) {
  const ritual = toUint32(ctx.ritualSeed ?? (a.seed ^ b.seed));
  const childSeed = mixSeeds(mixSeeds(a.seed, b.seed), ritual);
  const r = new Rng(childSeed);

  // Inherit element/form from a parent (with small chance of a fresh roll = "throwback").
  const inheritedElement = r.chance(0.46) ? a.element : r.chance(0.85) ? b.element : null;
  const inheritedForm = r.chance(0.46) ? a.form : r.chance(0.85) ? b.form : null;

  // Child rarity tends toward the better parent, with a chance to climb (the
  // "breeding ladder") or, rarely, to slip. This keeps high-tier supply scarce.
  const childRarity = inheritRarity(r, a.rarity, b.rarity, ctx);

  // Build the base child from its own seed/context, then overlay inheritance so the
  // result still looks like a coherent generated creature.
  const child = generateLumi(childSeed, {
    ...ctx,
    parentIds: [a.seed, b.seed].map(encodeSeedCode),
  });

  if (inheritedElement) child.element = inheritedElement;
  if (inheritedForm) child.form = inheritedForm;
  child.rarity = childRarity;

  // Inherit a subset of parent mutations, plus the child's own fresh rolls (already
  // present from generateLumi). Heritable mutations make "shiny lines" possible.
  const heritable = [...new Set([...a.mutations, ...b.mutations])].filter(() => r.chance(0.25));
  child.mutations = [...new Set([...child.mutations, ...heritable])];

  // Recompute derived fields that depend on the overlaid traits.
  const elementDef = ELEMENTS.find((e) => e.id === child.element) || ELEMENTS[0];
  const formDef = FORMS.find((f) => f.id === child.form) || FORMS[0];
  const rarityDef = RARITIES.find((x) => x.id === child.rarity) || RARITIES[0];
  child.species = `${elementDef.label} ${formDef.label}`;
  child.glow = +(rarityDef.glow + (child.mutations.includes('aurora') ? 0.2 : 0)).toFixed(3);
  child.render.aura.glow = rarityDef.glow;
  child.render.extras.halo = child.mutations.includes('halo');
  child.render.extras.crystalline = child.mutations.includes('crystalline');
  child.lineage = [encodeSeedCode(a.seed), encodeSeedCode(b.seed)];
  child.power = child.stats.charm + child.stats.vigor + child.stats.harmony + child.stats.spark;
  return child;
}

/**
 * Inheritance curve for rarity: mostly tracks the higher parent, with a modest
 * upgrade chance (boosted by world bloom) and a small downgrade chance.
 * @param {Rng} r
 */
function inheritRarity(r, ra, rb, ctx) {
  const hi = Math.max(RARITY_ORDER.indexOf(ra), RARITY_ORDER.indexOf(rb));
  const upChance = 0.12 + clamp01((ctx.bloomLevel ?? 0) / 100) * 0.18;
  let idx = hi;
  if (r.chance(upChance) && idx < RARITY_ORDER.length - 1) idx += 1;
  else if (r.chance(0.1) && idx > 0) idx -= 1;
  return RARITY_ORDER[idx];
}

/* --------------------------------------------------------------------------
 * Seed codes: human-shareable base32 representation of the 32-bit seed.
 * Players screenshot/share these to let friends regenerate the exact Lumi.
 * ------------------------------------------------------------------------ */
const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Crockford-ish, no ambiguous chars

/** @param {number} seed uint32 -> e.g. "LUMI-7F3K-9QZ2" */
export function encodeSeedCode(seed) {
  let n = toUint32(seed);
  let out = '';
  for (let i = 0; i < 7; i++) {
    out = B32[n & 31] + out;
    n = Math.floor(n / 32);
  }
  return `LUMI-${out.slice(0, 4)}-${out.slice(4)}`;
}

/** Parse a seed code back to its uint32 seed (throws on malformed input). */
export function decodeSeedCode(code) {
  const cleaned = code.replace(/^LUMI-/i, '').replace(/-/g, '').toUpperCase();
  if (cleaned.length < 7) throw new Error('Invalid seed code');
  let n = 0;
  for (const ch of cleaned.slice(0, 7)) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error(`Invalid character in seed code: ${ch}`);
    n = n * 32 + v;
  }
  return toUint32(n);
}

/** @param {number} n */
function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

/**
 * @typedef {Object} Genome
 * @property {number} schema
 * @property {number} seed
 * @property {string} seedCode
 * @property {string} name
 * @property {string} species
 * @property {string} rarity
 * @property {string} element
 * @property {string} form
 * @property {string} pattern
 * @property {string} temperament
 * @property {number} size
 * @property {number} eyeCount
 * @property {string[]} mutations
 * @property {number} glow
 * @property {Object} palette
 * @property {{charm:number,vigor:number,harmony:number,spark:number}} stats
 * @property {Object} render
 * @property {number} power
 * @property {string[]} lineage
 * @property {Object} bornFrom
 */
