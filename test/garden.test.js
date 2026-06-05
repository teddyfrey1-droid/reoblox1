// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGarden, plant, water, harvest, isReady, gardenView,
} from '../core/garden.js';

const WORLD = { season: 'spring', bloomLevel: 40 };

test('a new garden has a biome and empty plots', () => {
  const g = createGarden('meadow', 2);
  assert.equal(g.biome, 'meadow');
  assert.equal(g.plots.length, 2);
  assert.equal(g.plots[0].planting, null);
});

test('planting occupies a plot and rejects double-planting', () => {
  const g = createGarden('meadow', 2);
  plant(g, 0, 'dewbud', WORLD, 1_000_000);
  assert.ok(g.plots[0].planting);
  assert.throws(() => plant(g, 0, 'dewbud', WORLD, 1_000_000), /occupied/);
});

test('cannot harvest before ready, can after', () => {
  const g = createGarden('meadow', 1);
  const now = 1_000_000;
  const p = plant(g, 0, 'dewbud', WORLD, now); // dewbud = 5 min grow
  assert.equal(isReady(p, now), false);
  assert.throws(() => harvest(g, 0, now), /Not ready/);
  const later = now + 6 * 60 * 1000;
  assert.equal(isReady(p, later), true);
  const { lumi } = harvest(g, 0, later);
  assert.ok(lumi.seedCode.startsWith('LUMI-'));
  assert.equal(g.plots[0].planting, null, 'plot freed after harvest');
});

test('harvest is deterministic for identical plant state', () => {
  const make = () => {
    const g = createGarden('tide_pools', 1);
    plant(g, 0, 'tideleaf', WORLD, 2_000_000);
    return harvest(g, 0, 2_000_000 + 60 * 60 * 1000);
  };
  assert.deepEqual(make().lumi, make().lumi);
});

test('watering speeds growth and improves care (caps at 3)', () => {
  const g = createGarden('meadow', 1);
  const now = 5_000_000;
  plant(g, 0, 'sunpetal', WORLD, now); // 30 min
  const before = g.plots[0].planting.readyAt;
  const w1 = water(g, 0, now);
  assert.equal(w1.watered, 1);
  assert.ok(w1.readyAt < before, 'watering shortens grow time');
  water(g, 0, now); water(g, 0, now);
  const capped = water(g, 0, now);
  assert.equal(capped.watered, 3, 'watering caps at 3');
});

test('watered plants yield higher average power than neglected ones', () => {
  // Care quality feeds stats → expect a measurable lift across samples.
  const sample = (waterIt) => {
    let total = 0;
    const N = 60;
    for (let i = 0; i < N; i++) {
      const g = createGarden('meadow', 1);
      const now = 10_000_000 + i * 1234;
      plant(g, 0, 'dewbud', WORLD, now);
      if (waterIt) { water(g, 0, now); water(g, 0, now); water(g, 0, now); }
      total += harvest(g, 0, now + 60 * 60 * 1000).lumi.power;
    }
    return total / N;
  };
  assert.ok(sample(true) > sample(false), 'tended gardens produce stronger Lumi on average');
});

test('gardenView exposes countdowns and states for the client', () => {
  const g = createGarden('meadow', 2);
  const now = 1_000_000;
  plant(g, 0, 'dewbud', WORLD, now);
  const view = gardenView(g, now);
  assert.equal(view.plots[0].state, 'growing');
  assert.ok(view.plots[0].secondsLeft > 0);
  assert.equal(view.plots[1].state, 'empty');
});
