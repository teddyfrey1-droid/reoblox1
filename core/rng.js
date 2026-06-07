// @ts-check
/**
 * Deterministic, seedable pseudo-random number generation.
 *
 * Why deterministic RNG matters for LUMORA:
 *  - Every Lumi is derived from a 32-bit seed. The same seed ALWAYS produces the
 *    same creature, on any device, client or server. That makes seeds shareable
 *    ("seed codes"), makes the server authoritative, and makes the system unit-testable.
 *  - We avoid Math.random() entirely so gameplay outcomes are reproducible and
 *    auditable (anti-cheat: the server can replay any roll from its inputs).
 *
 * Algorithms used:
 *  - splitmix32 to expand a single integer seed into a well-mixed state.
 *  - mulberry32 as the fast streaming generator.
 * Both are tiny, fast, and have good statistical distribution for game purposes
 * (they are NOT cryptographic — never use this for security tokens).
 */

/** Force a value into an unsigned 32-bit integer. */
export function toUint32(n) {
  return n >>> 0;
}

/**
 * Hash an arbitrary string into a 32-bit seed (FNV-1a variant).
 * Used to turn human-friendly seed codes / player ids into numeric seeds.
 * @param {string} str
 * @returns {number} uint32
 */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // h *= 16777619 (FNV prime) using 32-bit safe multiply
    h = Math.imul(h, 0x01000193);
  }
  return toUint32(h);
}

/**
 * Mix two 32-bit seeds into one. Order matters (not commutative on purpose),
 * so combining (gardenSeed, slot) gives distinct streams per slot.
 * @param {number} a
 * @param {number} b
 */
export function mixSeeds(a, b) {
  let h = toUint32(a ^ 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h ^= toUint32(b);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  return toUint32(h ^ (h >>> 15));
}

/**
 * A small, deterministic RNG instance.
 * Provides float/int/pick/weighted/shuffle helpers used across the game systems.
 */
export class Rng {
  /** @param {number|string} seed */
  constructor(seed) {
    const numeric = typeof seed === 'string' ? hashString(seed) : toUint32(seed);
    // splitmix32 warm-up to decorrelate low-entropy seeds (e.g. 1, 2, 3...)
    let z = toUint32(numeric + 0x9e3779b9);
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    this._state = toUint32(z ^ (z >>> 16));
    this.seed = numeric;
  }

  /** @returns {number} next float in [0, 1) */
  next() {
    // mulberry32
    this._state = toUint32(this._state + 0x6d2b79f5);
    let t = this._state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Integer in [min, max] inclusive.
   * @param {number} min
   * @param {number} max
   */
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Float in [min, max). */
  float(min, max) {
    return min + this.next() * (max - min);
  }

  /** True with probability p (0..1). */
  chance(p) {
    return this.next() < p;
  }

  /**
   * Pick one element uniformly.
   * @template T
   * @param {readonly T[]} arr
   * @returns {T}
   */
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /**
   * Weighted pick. Accepts either an array of {value, weight} or parallel arrays.
   * @template T
   * @param {Array<{value: T, weight: number}>} entries
   * @returns {T}
   */
  weighted(entries) {
    let total = 0;
    for (const e of entries) total += e.weight;
    let roll = this.next() * total;
    for (const e of entries) {
      roll -= e.weight;
      if (roll < 0) return e.value;
    }
    return entries[entries.length - 1].value;
  }

  /**
   * In-place Fisher-Yates shuffle (returns a new array, leaves input untouched).
   * @template T
   * @param {readonly T[]} arr
   * @returns {T[]}
   */
  shuffle(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}

/**
 * Convenience factory.
 * @param {number|string} seed
 */
export function rng(seed) {
  return new Rng(seed);
}
