// @ts-check
/**
 * Progression & retention systems: Keeper Level (XP), daily login streaks, and
 * the daily quest generator.
 *
 * These are the levers that turn a fun toy into a habit:
 *  - XP/levels give a steady long-term goal and pace feature unlocks (LEVEL_UNLOCKS).
 *  - Daily streaks exploit loss-aversion gently: missing a day costs your multiplier,
 *    not your whole streak instantly (one "grace" day) — punishing enough to motivate,
 *    forgiving enough to avoid rage-churn.
 *  - Daily quests are deterministically generated per (player, day) so they're stable
 *    across a day, varied across days, and identical on every device without storage.
 */

import { xpForLevel, LEVEL_UNLOCKS, DAILY_REWARDS } from './content.js';
import { Rng } from './rng.js';

/**
 * Resolve a cumulative XP total into a level + progress-to-next.
 * @param {number} totalXp
 */
export function levelFromXp(totalXp) {
  let level = 1;
  while (xpForLevel(level + 1) <= totalXp) level++;
  const curFloor = xpForLevel(level);
  const nextFloor = xpForLevel(level + 1);
  return {
    level,
    xpIntoLevel: totalXp - curFloor,
    xpForNext: nextFloor - curFloor,
    progress: +((totalXp - curFloor) / (nextFloor - curFloor)).toFixed(4),
  };
}

/**
 * Apply XP, returning the new level info plus any unlocks crossed. The API uses
 * `unlocked` to fire celebratory UI and to flip server-side feature gates.
 * @param {number} prevXp
 * @param {number} addXp
 */
export function applyXp(prevXp, addXp) {
  const before = levelFromXp(prevXp);
  const totalXp = prevXp + Math.max(0, addXp);
  const after = levelFromXp(totalXp);
  const unlocked = [];
  for (let lvl = before.level + 1; lvl <= after.level; lvl++) {
    if (LEVEL_UNLOCKS[lvl]) unlocked.push({ level: lvl, ...LEVEL_UNLOCKS[lvl] });
  }
  return { totalXp, ...after, leveledUp: after.level > before.level, unlocked };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Convert an epoch ms to an integer day index (UTC). Stable bucket for "a day". */
export function dayIndex(epochMs) {
  return Math.floor(epochMs / DAY_MS);
}

/**
 * Process a daily login claim.
 *
 * @param {Object} state            player's persisted streak state
 * @param {number} [state.lastClaimDay]
 * @param {number} [state.streak]   current consecutive-day count
 * @param {number} nowMs
 * @returns {{ updated: object, reward: object, streak: number, alreadyClaimed: boolean, broke: boolean }}
 */
export function claimDaily(state, nowMs) {
  const today = dayIndex(nowMs);
  const last = state.lastClaimDay ?? null;

  if (last === today) {
    // Idempotent: claiming twice in a day is a no-op, not an error (offline/retry safe).
    return { updated: state, reward: { petals: 0 }, streak: state.streak ?? 1, alreadyClaimed: true, broke: false };
  }

  let streak = state.streak ?? 0;
  let broke = false;
  if (last === null || last === today - 1) {
    streak += 1; // continued streak
  } else if (last === today - 2) {
    // One grace day: streak continues but does NOT increment (the "soft" penalty).
    broke = false;
  } else {
    streak = 1; // streak reset
    broke = true;
  }

  // Reward ladder cycles weekly; the day-7 keystone (premium currency) repeats.
  const ladderDay = ((streak - 1) % 7) + 1;
  const base = DAILY_REWARDS.find((d) => d.day === ladderDay) || DAILY_REWARDS[0];
  // Streak multiplier on petals only (never inflate premium currency via streaks):
  const weeks = Math.floor((streak - 1) / 7);
  const mult = 1 + Math.min(1.0, weeks * 0.1); // up to +100% after 10 weeks
  const reward = {
    petals: Math.round((base.petals || 0) * mult),
    lumen: base.lumen || 0,
    seeds: base.seeds || [],
  };

  const updated = { ...state, lastClaimDay: today, streak };
  return { updated, reward, streak, alreadyClaimed: false, broke };
}

/**
 * Daily quest templates. Each is a small, completable-in-one-session objective.
 * `make` produces a concrete instance (with target numbers) from an Rng so the
 * same player gets the same three quests all day, fresh ones tomorrow.
 */
const QUEST_TEMPLATES = [
  { id: 'plant_seeds', verb: 'Plant', noun: 'seeds', min: 2, max: 5, xp: 60, petals: 80 },
  { id: 'hatch_lumi', verb: 'Hatch', noun: 'Lumi', min: 1, max: 3, xp: 90, petals: 120 },
  { id: 'visit_neighbours', verb: 'Visit', noun: 'neighbours', min: 1, max: 3, xp: 70, petals: 90 },
  { id: 'water_plants', verb: 'Water', noun: 'plants', min: 3, max: 8, xp: 50, petals: 70 },
  { id: 'take_photos', verb: 'Photograph', noun: 'Lumi', min: 1, max: 3, xp: 65, petals: 85 },
  { id: 'decorate', verb: 'Place', noun: 'decorations', min: 1, max: 3, xp: 55, petals: 75 },
];

/**
 * Deterministically generate today's quests for a player.
 * @param {string|number} playerId
 * @param {number} nowMs
 * @param {number} [count]
 */
export function dailyQuests(playerId, nowMs, count = 3) {
  const seedBase = `${playerId}:${dayIndex(nowMs)}`;
  const r = new Rng(seedBase);
  const chosen = r.shuffle(QUEST_TEMPLATES).slice(0, count);
  return chosen.map((tpl) => {
    const target = r.int(tpl.min, tpl.max);
    return {
      id: tpl.id,
      text: `${tpl.verb} ${target} ${tpl.noun}`,
      target,
      progress: 0,
      reward: { xp: tpl.xp, petals: tpl.petals },
      done: false,
    };
  });
}

/**
 * Advance a quest's progress and detect completion (idempotent on the `done` flag).
 * @param {{target:number, progress:number, done:boolean}} quest
 * @param {number} amount
 */
export function advanceQuest(quest, amount = 1) {
  if (quest.done) return { quest, justCompleted: false };
  quest.progress = Math.min(quest.target, quest.progress + amount);
  const justCompleted = quest.progress >= quest.target;
  quest.done = justCompleted;
  return { quest, justCompleted };
}
