// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  levelFromXp, applyXp, claimDaily, dailyQuests, advanceQuest, dayIndex,
} from '../core/progression.js';

const DAY = 24 * 60 * 60 * 1000;

test('XP maps to levels with monotonic progress', () => {
  assert.equal(levelFromXp(0).level, 1);
  const a = levelFromXp(0);
  const b = levelFromXp(500);
  assert.ok(b.level >= a.level);
  const info = levelFromXp(300);
  assert.ok(info.progress >= 0 && info.progress <= 1);
});

test('applyXp reports level-ups and crosses feature unlocks', () => {
  const res = applyXp(0, 5000); // should cross several unlock levels
  assert.ok(res.leveledUp);
  const unlockedLevels = res.unlocked.map((u) => u.level);
  assert.ok(unlockedLevels.includes(2), 'second plot unlock at L2 should fire');
  assert.ok(res.unlocked.some((u) => u.feature === 'breeding'), 'breeding unlock fires');
});

test('daily streak: continues on consecutive days', () => {
  let state = { streak: 0 };
  const d0 = 100 * DAY;
  let res = claimDaily(state, d0);
  assert.equal(res.streak, 1);
  res = claimDaily(res.updated, d0 + DAY);
  assert.equal(res.streak, 2);
  res = claimDaily(res.updated, d0 + 2 * DAY);
  assert.equal(res.streak, 3);
});

test('daily streak: claiming twice in one day is idempotent', () => {
  const d0 = 100 * DAY;
  const first = claimDaily({ streak: 0 }, d0);
  const again = claimDaily(first.updated, d0 + 1000);
  assert.ok(again.alreadyClaimed);
  assert.equal(again.reward.petals, 0);
  assert.equal(again.streak, first.streak);
});

test('daily streak: one grace day keeps the streak, longer gap resets', () => {
  const d0 = 100 * DAY;
  const r1 = claimDaily({ streak: 0 }, d0);       // streak 1, lastDay = 100
  const grace = claimDaily(r1.updated, d0 + 2 * DAY); // skipped day 101 → grace
  assert.equal(grace.broke, false, 'a single missed day is forgiven');
  const reset = claimDaily({ streak: 5, lastClaimDay: 100 }, (100 + 4) * DAY);
  assert.equal(reset.broke, true);
  assert.equal(reset.streak, 1);
});

test('daily quests are deterministic per player per day, fresh next day', () => {
  const now = 500 * DAY + 3 * 3600 * 1000;
  const q1 = dailyQuests('player-A', now);
  const q2 = dailyQuests('player-A', now + 1000); // same day
  assert.deepEqual(q1, q2);
  const tomorrow = dailyQuests('player-A', now + DAY);
  assert.notDeepEqual(q1.map((q) => q.text), tomorrow.map((q) => q.text));
  const other = dailyQuests('player-B', now);
  assert.notDeepEqual(q1.map((q) => q.id + q.target), other.map((q) => q.id + q.target));
  assert.equal(q1.length, 3);
});

test('quest progress completes once and stays completed', () => {
  const q = { target: 3, progress: 0, done: false };
  assert.equal(advanceQuest(q, 1).justCompleted, false);
  assert.equal(advanceQuest(q, 1).justCompleted, false);
  assert.equal(advanceQuest(q, 1).justCompleted, true);
  assert.equal(advanceQuest(q, 1).justCompleted, false, 'already done → not re-completed');
  assert.equal(q.progress, 3, 'progress capped at target');
});

test('dayIndex buckets time into stable UTC days', () => {
  assert.equal(dayIndex(0), 0);
  assert.equal(dayIndex(DAY - 1), 0);
  assert.equal(dayIndex(DAY), 1);
});
