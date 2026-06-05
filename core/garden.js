// @ts-check
/**
 * Garden / plot system — the core gameplay loop's stateful heart.
 *
 * Loop:  buy seed → plant in a plot → it grows over real time → harvest → a Lumi
 *        is BORN (genome generated from the plot's context) → collect / breed / show off.
 *
 * Everything is time-driven and server-authoritative: the client predicts, the
 * server confirms using these same pure functions. `nowMs` is always injected so
 * the system is deterministic and testable (no hidden Date.now()).
 */

import { byId } from './content.js';
import { generateLumi } from './genome.js';
import { mixSeeds, hashString } from './rng.js';

/**
 * @typedef {Object} Plot
 * @property {number} index
 * @property {?Object} planting  null when empty
 */

/**
 * Create a fresh garden for a new player: one biome, a couple of empty plots.
 * @param {string} biomeId
 * @param {number} plots
 */
export function createGarden(biomeId = 'meadow', plots = 2) {
  return {
    biome: biomeId,
    bloom: 0, // local garden bloom 0..100 (rises as you tend it; feeds Lumi luck)
    careStreak: 0,
    plots: Array.from({ length: plots }, (_, i) => ({ index: i, planting: null })),
    decor: [],
  };
}

/**
 * Plant a seed into an empty plot. Records the plant + the exact "born context"
 * snapshot so the eventual Lumi is reproducible from stored state alone.
 * @param {object} garden
 * @param {number} plotIndex
 * @param {string} plantId
 * @param {object} world   { season, bloomLevel } — global live context
 * @param {number} nowMs
 */
export function plant(garden, plotIndex, plantId, world, nowMs) {
  const plot = garden.plots[plotIndex];
  if (!plot) throw new Error(`No plot at index ${plotIndex}`);
  if (plot.planting) throw new Error('Plot is already occupied');
  const def = byId.plant(plantId);
  if (!def) throw new Error(`Unknown plant "${plantId}"`);

  const readyAt = nowMs + def.growMinutes * 60 * 1000;
  // The Lumi seed is fixed at PLANT time from stable inputs, so growth duration and
  // server restarts never change the outcome — what you planted is what you'll get.
  const lumiSeed = mixSeeds(
    hashString(`${garden.biome}:${plantId}:${plotIndex}`),
    (nowMs ^ (garden.bloom * 2654435761)) >>> 0,
  );

  plot.planting = {
    plantId,
    plantedAt: nowMs,
    readyAt,
    watered: 0,
    lumiSeed,
    context: {
      biome: garden.biome,
      plantSpecies: plantId,
      season: world.season,
      bloomLevel: world.bloomLevel ?? garden.bloom,
      // careQuality is finalised at harvest from watering; stored partial here.
      rarityLuck: def.rarityLuck,
    },
  };
  return plot.planting;
}

/**
 * Watering accelerates growth slightly and improves the eventual Lumi's care
 * quality (better stats / luck). Caps prevent spam. This is the "active play beats
 * idle" reward that keeps sessions engaging without punishing idlers.
 * @param {object} garden
 * @param {number} plotIndex
 * @param {number} nowMs
 */
export function water(garden, plotIndex, nowMs) {
  const plot = garden.plots[plotIndex];
  if (!plot || !plot.planting) throw new Error('Nothing planted here');
  const p = plot.planting;
  if (p.watered >= 3) return { watered: p.watered, readyAt: p.readyAt }; // cap reached
  p.watered += 1;
  // Each watering shaves 8% off the remaining time.
  const remaining = Math.max(0, p.readyAt - nowMs);
  p.readyAt = nowMs + Math.round(remaining * 0.92);
  return { watered: p.watered, readyAt: p.readyAt };
}

/** Has the planting finished growing? @param {object} planting @param {number} nowMs */
export function isReady(planting, nowMs) {
  return !!planting && nowMs >= planting.readyAt;
}

/**
 * Harvest a ready plot: generate the Lumi from its locked seed + finalised context,
 * empty the plot, and bump the garden's local bloom (tending is rewarded).
 * @param {object} garden
 * @param {number} plotIndex
 * @param {number} nowMs
 * @returns {{ lumi: object, garden: object }}
 */
export function harvest(garden, plotIndex, nowMs) {
  const plot = garden.plots[plotIndex];
  if (!plot || !plot.planting) throw new Error('Nothing planted here');
  const p = plot.planting;
  if (!isReady(p, nowMs)) throw new Error('Not ready to harvest yet');

  // careQuality blends watering effort with the garden's overall bloom.
  const careQuality = Math.min(1, 0.35 + p.watered * 0.18 + garden.bloom / 300);
  const ctx = {
    ...p.context,
    careQuality,
    // Premium/seasonal seeds fold their rarityLuck into bloomLevel-equivalent luck.
    bloomLevel: Math.min(100, (p.context.bloomLevel || 0) + (p.context.rarityLuck || 0) * 60),
  };

  const lumi = generateLumi(p.lumiSeed, ctx);
  plot.planting = null;
  garden.bloom = Math.min(100, garden.bloom + 2); // each harvest nudges local bloom
  garden.careStreak += 1;
  return { lumi, garden };
}

/**
 * A serialisable, client-friendly view of a garden's live state (with countdowns).
 * @param {object} garden
 * @param {number} nowMs
 */
export function gardenView(garden, nowMs) {
  return {
    biome: garden.biome,
    bloom: garden.bloom,
    decor: garden.decor,
    plots: garden.plots.map((plot) => {
      if (!plot.planting) return { index: plot.index, state: 'empty' };
      const p = plot.planting;
      const ready = isReady(p, nowMs);
      return {
        index: plot.index,
        state: ready ? 'ready' : 'growing',
        plantId: p.plantId,
        watered: p.watered,
        secondsLeft: ready ? 0 : Math.ceil((p.readyAt - nowMs) / 1000),
      };
    }),
  };
}
