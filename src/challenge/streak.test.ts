import { describe, expect, it } from 'vitest';
import { createChallenge, recordReps, type Challenge } from './engine';
import { getPlannedDay } from './plan';
import { computeStreak } from './streak';

const START = '2026-01-01';

/** Meets the target for each listed day. Rest days are skipped automatically. */
function withDays(...days: number[]): Challenge {
  let challenge = createChallenge(START, 'streak-test');
  for (const day of days) {
    const planned = getPlannedDay(day);
    if (planned.isRest) continue;
    challenge = recordReps(challenge, day, planned.target).challenge;
  }
  return challenge;
}

/** `YYYY-MM-DD` for day N of a challenge starting 2026-01-01. */
const on = (day: number) => `2026-01-${String(day).padStart(2, '0')}`;

describe('computeStreak', () => {
  it('is zero for a fresh challenge', () => {
    expect(computeStreak(withDays(), on(1))).toEqual({ current: 0, longest: 0 });
  });

  it('counts consecutive completed days', () => {
    expect(computeStreak(withDays(1, 2, 3), on(3)).current).toBe(3);
  });

  it('does not penalise a day still in progress', () => {
    // Days 1-3 done, day 4 not started yet — the streak should hold at 3.
    expect(computeStreak(withDays(1, 2, 3), on(4)).current).toBe(3);
  });

  it('breaks once a missed day is in the past', () => {
    // Day 4 was missed and day 5 is now today.
    expect(computeStreak(withDays(1, 2, 3), on(5)).current).toBe(0);
  });

  it('counts today as soon as it is finished', () => {
    expect(computeStreak(withDays(1, 2, 3, 4), on(4)).current).toBe(4);
  });

  it('carries the streak across a rest day without inflating it', () => {
    // Days 1-6 done, day 7 is a rest day, day 8 done → six squat days + one more.
    const challenge = withDays(1, 2, 3, 4, 5, 6, 8);
    expect(computeStreak(challenge, on(8)).current).toBe(7);
  });

  it('does not let a rest day alone create a streak', () => {
    expect(computeStreak(withDays(), on(7)).current).toBe(0);
  });

  it('restarts after a break', () => {
    // Missed day 3; days 4-5 completed and day 5 is today.
    expect(computeStreak(withDays(1, 2, 4, 5), on(5)).current).toBe(2);
  });

  it('remembers the longest run after the current one breaks', () => {
    const challenge = withDays(1, 2, 3, 4, 6);
    const { current, longest } = computeStreak(challenge, on(7));
    expect(current).toBe(1); // day 6 only; day 5 was missed
    expect(longest).toBe(4); // days 1-4
  });

  it('never reports a longest shorter than the current streak', () => {
    const { current, longest } = computeStreak(withDays(1, 2, 3), on(3));
    expect(longest).toBeGreaterThanOrEqual(current);
  });

  it('counts a partial day as a miss, not a completion', () => {
    let challenge = createChallenge(START, 'partial');
    challenge = recordReps(challenge, 1, 19).challenge; // target is 20
    expect(computeStreak(challenge, on(2)).current).toBe(0);
  });

  it('reaches 26 when every active day of the challenge is completed', () => {
    const challenge = withDays(...Array.from({ length: 30 }, (_, i) => i + 1));
    expect(computeStreak(challenge, '2026-01-30').current).toBe(26);
  });
});
