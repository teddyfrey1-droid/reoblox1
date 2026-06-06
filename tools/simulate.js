// @ts-check
/**
 * Balance simulation harness.
 *
 * Runs a synthetic player population through the REAL game-core modules (economy,
 * generation, pity, progression, Bloomdex) over D days and writes a data-driven
 * balance report to docs/BALANCE-REPORT.md. This is how we validate the economy
 * (faucet/sink health), the rarity curve, the pity system and progression pacing
 * BEFORE exposing changes to live players — the pay-off of a deterministic core.
 *
 *   node tools/simulate.js            # 500 players × 30 days (default)
 *   node tools/simulate.js 2000 45    # custom population / horizon
 *
 * Note: this models the SOFT-currency loop precisely (it uses the same credit/
 * debit/purchase functions the server uses). Premium (Lumen) spend is modelled
 * with conservative, clearly-labelled assumptions — it is not a revenue forecast
 * (see docs/12-BUSINESS-PLAN.md for that).
 */

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Rng } from '../core/rng.js';
import { createWallet, grant, debit, purchase, faucetSinkReport, EconomyError } from '../core/economy.js';
import { PLANTS } from '../core/content.js';
import { generateLumi, RARITIES } from '../core/genome.js';
import { createPity, pityFloor, recordHatch } from '../core/luck.js';
import { applyXp, levelFromXp, claimDaily } from '../core/progression.js';
import { bloomdex } from '../core/bloomdex.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const N = Number(process.argv[2]) || 500;
const DAYS = Number(process.argv[3]) || 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Engagement segments with realistic day-to-day behaviour. */
const SEGMENTS = [
  { id: 'casual', share: 0.6, plantsPerDay: [1, 3], breedChance: 0.05, decorChance: 0.25, premiumSeedChance: 0.0 },
  { id: 'core', share: 0.3, plantsPerDay: [3, 6], breedChance: 0.2, decorChance: 0.4, premiumSeedChance: 0.05 },
  { id: 'hardcore', share: 0.1, plantsPerDay: [6, 12], breedChance: 0.45, decorChance: 0.5, premiumSeedChance: 0.2 },
];

/**
 * Cosmetic & expansion price menu (Petals). In a cozy game the soft-currency sink
 * is ELASTIC — there is always more decor/biome/expansion to buy — so engaged
 * players self-regulate by spending their surplus on self-expression. Modelling
 * that spend is what makes the faucet/sink estimate realistic (rather than assuming
 * players hoard infinitely).
 */
const COSMETIC_PRICES = [80, 120, 220, 340, 500, 800, 1500, 2500, 6000];

function pickSegment(r) {
  const x = r.next();
  let acc = 0;
  for (const s of SEGMENTS) { acc += s.share; if (x < acc) return s; }
  return SEGMENTS[0];
}

/** Cheapest affordable petals seed, or null. */
function affordableSeed(wallet) {
  const petalSeeds = PLANTS.filter((p) => p.cost.petals != null).sort((a, b) => a.cost.petals - b.cost.petals);
  return petalSeeds.find((p) => wallet.petals >= p.cost.petals) || null;
}

function main() {
  const r = new Rng(0x5EED);
  const ledger = []; // population-wide soft+premium ledger (the faucet/sink record)
  const rarityCounts = Object.fromEntries(RARITIES.map((x) => [x.id, 0]));
  let totalHatches = 0;
  let pityRescues = 0;
  let maxDryStreak = 0;

  // Shared world bloom rises with collective hatches (mirrors server/store.js).
  let worldBloom = 20;

  const players = Array.from({ length: N }, (_, i) => {
    const pr = new Rng(i * 2654435761 + 1);
    const seg = pickSegment(pr);
    const wallet = createWallet();
    grant(wallet, { petals: 300, lumen: 50 }, 'onboarding', ledger);
    return {
      rng: pr, seg, wallet, xp: 0, pity: createPity(),
      streak: { streak: 0, lastClaimDay: undefined },
      collection: [], // store {element,form,rarity,mutations} for Bloomdex
      dry: 0, levelAt: {},
    };
  });

  const segUnlocked = { breeding: 0, trading: 0 };
  const levelSamples = { 7: [], 14: [], 30: [] };

  for (let day = 0; day < DAYS; day++) {
    const now = (1000 + day) * DAY_MS + 8 * 3600 * 1000;
    for (const p of players) {
      // 1) Daily reward (real streak + economy logic).
      const dc = claimDaily(p.streak, now);
      p.streak = dc.updated;
      if (!dc.alreadyClaimed) grant(p.wallet, { petals: dc.reward.petals, lumen: dc.reward.lumen || 0 }, 'daily_reward', ledger);

      // 2) Quests: ~3 completed (XP + petals faucet).
      const quests = 2 + (p.rng.next() < 0.6 ? 1 : 0);
      for (let q = 0; q < quests; q++) {
        grant(p.wallet, { petals: 80 }, 'quest', ledger);
        p.xp = applyXp(p.xp, 70).totalXp;
      }

      // 3) Plant + harvest loop (seed = sink; hatch = generation w/ pity).
      const plants = p.rng.int(p.seg.plantsPerDay[0], p.seg.plantsPerDay[1]);
      for (let k = 0; k < plants; k++) {
        // Premium seed sometimes (better luck) — a labelled Lumen sink.
        let seed = null;
        if (p.rng.next() < p.seg.premiumSeedChance && p.wallet.lumen >= 18) {
          seed = PLANTS.find((x) => x.id === 'moonvine');
          try { purchase(p.wallet, 'plant', seed.id, ledger); } catch { seed = null; }
        }
        if (!seed) {
          seed = affordableSeed(p.wallet);
          if (!seed) break; // out of petals this day
          try { purchase(p.wallet, 'plant', seed.id, ledger); } catch { break; }
        }
        // Hatch: care ~ segment-tuned; pity floor evaluated live.
        const care = clamp01(0.4 + p.rng.next() * 0.4);
        const floor = pityFloor(p.pity);
        if (floor) pityRescues++;
        const lumi = generateLumi(
          (p.rng.next() * 4294967296) >>> 0,
          { biome: 'meadow', season: 'spring', bloomLevel: worldBloom, careQuality: care, rarityFloor: floor || undefined, plantSpecies: seed.id },
        );
        recordHatch(p.pity, lumi.rarity);
        rarityCounts[lumi.rarity]++;
        totalHatches++;
        worldBloom = Math.min(100, worldBloom + 0.001);
        // dry-streak telemetry (consecutive non-rare).
        if (rank(lumi.rarity) >= rank('rare')) { maxDryStreak = Math.max(maxDryStreak, p.dry); p.dry = 0; } else p.dry++;
        p.collection.push({ element: lumi.element, form: lumi.form, rarity: lumi.rarity, mutations: lumi.mutations });
        p.xp = applyXp(p.xp, 40 + rank(lumi.rarity) * 25).totalXp;
      }

      // 4) Occasional breeding (a Lumen sink) for engaged players.
      if (p.collection.length >= 2 && p.wallet.lumen >= 25 && p.rng.next() < p.seg.breedChance) {
        debit(p.wallet, 'lumen', 25, 'breed_ritual', ledger);
      }

      // 5) Self-expression: spend surplus Petals on cosmetics/expansions above a
      //    savings buffer. This is the elastic sink the design relies on — cozy
      //    players decorate, so soft currency does not pile up unbounded.
      const buffer = p.seg.id === 'hardcore' ? 1500 : p.seg.id === 'core' ? 900 : 500;
      let guard = 0;
      while (p.wallet.petals > buffer && guard++ < 12 && p.rng.next() < 0.85) {
        const affordable = COSMETIC_PRICES.filter((c) => c <= p.wallet.petals - buffer * 0.5);
        if (!affordable.length) break;
        const price = affordable[p.rng.int(0, affordable.length - 1)];
        debit(p.wallet, 'petals', price, 'shop:cosmetic', ledger);
      }
    }

    // Track progression pacing snapshots.
    const dayNum = day + 1;
    if (levelSamples[dayNum]) for (const p of players) levelSamples[dayNum].push(levelFromXp(p.xp).level);
  }

  // Feature-unlock reach (breeding L4, trading L8).
  for (const p of players) {
    const lvl = levelFromXp(p.xp).level;
    if (lvl >= 4) segUnlocked.breeding++;
    if (lvl >= 8) segUnlocked.trading++;
  }

  const report = faucetSinkReport(ledger);
  const dexPct = players.map((p) => bloomdex(p.collection).completion.species);
  const finalLevels = players.map((p) => levelFromXp(p.xp).level);

  const md = renderReport({
    N, DAYS, totalHatches, rarityCounts, report, pityRescues, maxDryStreak,
    worldBloom, levelSamples, segUnlocked, dexPct, finalLevels,
  });
  const out = join(ROOT, 'docs', 'BALANCE-REPORT.md');
  writeFileSync(out, md);
  console.log(`Wrote ${out}`);
  console.log(`Players ${N} × ${DAYS}d · hatches ${totalHatches} · petals faucet/sink ratio ${report.petalsFaucetSinkRatio}`);
}

/* ------------------------------ reporting -------------------------------- */

function renderReport(d) {
  const totalRar = Object.values(d.rarityCounts).reduce((a, b) => a + b, 0) || 1;
  const targetTotal = RARITIES.reduce((a, x) => a + x.weight, 0);
  const rarityRows = RARITIES.map((x) => {
    const observed = (d.rarityCounts[x.id] / totalRar) * 100;
    const target = (x.weight / targetTotal) * 100;
    return `| ${x.id} | ${d.rarityCounts[x.id].toLocaleString()} | ${observed.toFixed(2)}% | ${target.toFixed(2)}% |`;
  }).join('\n');

  const petals = d.report.petals;
  const ratio = d.report.petalsFaucetSinkRatio;
  const band = ratio >= 1.0 && ratio <= 1.18 ? '✅ within the healthy 1.0–1.18 band' : ratio > 1.18 ? '⚠️ above band (inflationary — add sinks)' : '⚠️ below band (deflationary — loosen faucets)';

  const sinkRows = Object.entries(d.report.byReason)
    .filter(([, v]) => v < 0)
    .sort((a, b) => a[1] - b[1])
    .map(([k, v]) => `| ${k} | ${Math.abs(v).toLocaleString()} |`).join('\n');
  const sourceRows = Object.entries(d.report.byReason)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `| ${k} | ${v.toLocaleString()} |`).join('\n');

  const avg = (a) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length) : 0);
  const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const p = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : 0; };

  return `# LUMORA — Balance Report (auto-generated)

> Generated by \`node tools/simulate.js\` using the **real** game-core modules
> (economy, generation, pity, progression, Bloomdex). Reproducible and deterministic
> (fixed seeds). Re-run after any balance change to catch regressions before live.

**Cohort:** ${d.N.toLocaleString()} simulated players × ${d.DAYS} days · **${d.totalHatches.toLocaleString()} Lumi hatched** · final world bloom ≈ ${d.worldBloom.toFixed(1)}%.

## 1. Soft-currency economy (Petals) — faucet/sink health

| | Petals |
|---|---|
| Total minted (sources) | ${petals.source.toLocaleString()} |
| Total burned (sinks) | ${petals.sink.toLocaleString()} |
| **Faucet/sink ratio** | **${ratio}** |

**Verdict:** ${band}. (Target band per \`docs/07-ECONOMY.md\`: keep the ratio ≈ 1.0–1.15;
live-ops adds cosmetic sinks or trims faucets if it drifts up.)

**Top sources**

| Source | Petals |
|---|---|
${sourceRows}

**Top sinks**

| Sink | Petals |
|---|---|
${sinkRows}

## 2. Rarity distribution (with pity) vs. configured target

| Rarity | Count | Observed | Target weight |
|---|---|---|---|
${rarityRows}

Observed should track the configured weights, lifted slightly toward rarer tiers by
world bloom, care quality and bad-luck protection — exactly the "tend your garden →
better Lumi" incentive (\`docs/03-GAMEPLAY.md\`).

## 3. Bad-luck protection (pity)

- Hatches rescued by a pity floor: **${d.pityRescues.toLocaleString()}** (${((d.pityRescues / d.totalHatches) * 100).toFixed(2)}% of all hatches).
- Longest observed dry streak before a rare+: **${d.maxDryStreak}** (design ceiling: < ${18}).

A low rescue rate with a bounded dry streak is the goal: most hatches are pure rolls,
and the genuinely unlucky are quietly protected.

## 4. Progression pacing (Keeper Level)

| Day | Median level | Avg level | P90 level |
|---|---|---|---|
| 7  | ${median(d.levelSamples[7])} | ${avg(d.levelSamples[7]).toFixed(1)} | ${p(d.levelSamples[7], 0.9)} |
| 14 | ${median(d.levelSamples[14])} | ${avg(d.levelSamples[14]).toFixed(1)} | ${p(d.levelSamples[14], 0.9)} |
| 30 | ${median(d.levelSamples[30])} | ${avg(d.levelSamples[30]).toFixed(1)} | ${p(d.levelSamples[30], 0.9)} |

- Reached **L4 (breeding unlock)** by day ${d.DAYS}: ${((d.segUnlocked.breeding / d.N) * 100).toFixed(0)}% of players.
- Reached **L8 (trading unlock)** by day ${d.DAYS}: ${((d.segUnlocked.trading / d.N) * 100).toFixed(0)}% of players.

## 5. Collection depth (Bloomdex species completion at day ${d.DAYS})

- Median: **${median(d.dexPct).toFixed(1)}%** · P90: ${p(d.dexPct, 0.9).toFixed(1)}% · max: ${Math.max(...d.dexPct).toFixed(1)}%.

Base species (element × form = ${36} combos) fill over the first weeks — that early
sense of progress is intentional. The genuinely long tail is the *deeper* completion:
every rarity and every mutation per species, plus seasonal/event-exclusive Lumi, which
keeps the completionist goal alive for many months (and is where the chase lives).

---
*This report is illustrative of the tuned constants in \`core/content.js\` and
\`core/genome.js\`. It models the soft-currency loop precisely; premium spend uses
conservative assumptions and is NOT a revenue forecast (see the business plan).*
`;
}

function rank(id) { return RARITIES.findIndex((x) => x.id === id); }
function clamp01(n) { return Math.max(0, Math.min(1, n)); }

main();
