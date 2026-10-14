import { describe, expect, it } from 'vitest';
import {
  createChallenge,
  currentDay,
  dateKeyForDay,
  daysCompleted,
  getDayProgress,
  getStats,
  isFinished,
  recordReps,
  totalReps,
} from './engine';
import { ACTIVE_DAY_COUNT, CHALLENGE_LENGTH, CHALLENGE_PLAN, getPlannedDay } from './plan';

const START = '2026-01-01';
const fresh = () => createChallenge(START, 'test-challenge');

/** Meets the target for every active day from 1 to `throughDay`. */
function completeThrough(throughDay: number) {
  let challenge = fresh();
  for (let day = 1; day <= throughDay; day += 1) {
    const planned = getPlannedDay(day);
    if (planned.isRest) continue;
    challenge = recordReps(challenge, day, planned.target).challenge;
  }
  return challenge;
}

describe('plan', () => {
  it('has exactly 30 days', () => {
    expect(CHALLENGE_PLAN).toHaveLength(CHALLENGE_LENGTH);
  });

  it('rests once a week', () => {
    const restDays = CHALLENGE_PLAN.filter((d) => d.isRest).map((d) => d.day);
    expect(restDays).toEqual([7, 14, 21, 28]);
    expect(ACTIVE_DAY_COUNT).toBe(CHALLENGE_LENGTH - restDays.length);
  });

  it('starts at 20 and finishes at 100', () => {
    expect(getPlannedDay(1).target).toBe(20);
    expect(getPlannedDay(30).target).toBe(100);
  });

  it('gives rest days a zero target', () => {
    expect(getPlannedDay(7)).toEqual({ day: 7, target: 0, isRest: true });
  });

  it('trends upward overall', () => {
    const weekTotal = (week: number) =>
      CHALLENGE_PLAN.slice(week * 7, week * 7 + 7).reduce((sum, d) => sum + d.target, 0);
    expect(weekTotal(1)).toBeGreaterThan(weekTotal(0));
    expect(weekTotal(3)).toBeGreaterThan(weekTotal(1));
  });

  it('rejects days outside the challenge', () => {
    expect(() => getPlannedDay(0)).toThrow(RangeError);
    expect(() => getPlannedDay(31)).toThrow(RangeError);
    expect(() => getPlannedDay(1.5)).toThrow(RangeError);
  });
});

describe('currentDay', () => {
  it('is day 1 on the start date', () => {
    expect(currentDay(fresh(), START)).toBe(1);
  });

  it('advances with the calendar', () => {
    expect(currentDay(fresh(), '2026-01-12')).toBe(12);
  });

  it('clamps to day 30 once the challenge is over', () => {
    expect(currentDay(fresh(), '2026-03-01')).toBe(CHALLENGE_LENGTH);
    expect(isFinished(fresh(), '2026-03-01')).toBe(true);
  });

  it('does not report day 30 as finished', () => {
    expect(currentDay(fresh(), '2026-01-30')).toBe(30);
    expect(isFinished(fresh(), '2026-01-30')).toBe(false);
  });

  it('clamps to day 1 if the clock is behind the start date', () => {
    expect(currentDay(fresh(), '2025-12-25')).toBe(1);
  });

  it('maps days back to calendar dates', () => {
    expect(dateKeyForDay(fresh(), 1)).toBe(START);
    expect(dateKeyForDay(fresh(), 30)).toBe('2026-01-30');
  });
});

describe('recordReps', () => {
  it('accumulates across several sets in a day', () => {
    let challenge = fresh();
    challenge = recordReps(challenge, 1, 8).challenge;
    challenge = recordReps(challenge, 1, 7).challenge;
    expect(getDayProgress(challenge, 1).completedReps).toBe(15);
    expect(getDayProgress(challenge, 1).completed).toBe(false);
  });

  it('completes the day when the target is met', () => {
    const result = recordReps(fresh(), 1, 20);
    expect(result.day.completed).toBe(true);
    expect(result.justCompleted).toBe(true);
    expect(result.day.completedAt).not.toBeNull();
  });

  it('reports justCompleted only on the crossing update', () => {
    const first = recordReps(fresh(), 1, 20);
    expect(first.justCompleted).toBe(true);
    const second = recordReps(first.challenge, 1, 5);
    expect(second.justCompleted).toBe(false);
    expect(second.day.completed).toBe(true);
  });

  it('keeps the original completion timestamp on later sets', () => {
    const first = recordReps(fresh(), 1, 20, new Date('2026-01-01T10:00:00Z'));
    const second = recordReps(first.challenge, 1, 5, new Date('2026-01-01T18:00:00Z'));
    expect(second.day.completedAt).toBe(first.day.completedAt);
  });

  it('counts overshoot toward the total', () => {
    const challenge = recordReps(fresh(), 1, 33).challenge;
    expect(totalReps(challenge)).toBe(33);
  });

  it('does not mutate the challenge it was given', () => {
    const before = fresh();
    recordReps(before, 1, 20);
    expect(before.days).toEqual({});
  });

  it('treats a rest day as already complete and never as a completion event', () => {
    const rest = getDayProgress(fresh(), 7);
    expect(rest.completed).toBe(true);
    const result = recordReps(fresh(), 7, 10);
    expect(result.justCompleted).toBe(false);
    expect(result.day.completedReps).toBe(10);
  });

  it('rejects nonsensical rep counts', () => {
    expect(() => recordReps(fresh(), 1, -1)).toThrow(RangeError);
    expect(() => recordReps(fresh(), 1, 2.5)).toThrow(RangeError);
  });

  it('rejects days outside the challenge', () => {
    expect(() => recordReps(fresh(), 31, 10)).toThrow(RangeError);
  });
});

describe('getStats', () => {
  it('reports a clean slate for a new challenge', () => {
    const stats = getStats(fresh(), START);
    expect(stats).toMatchObject({
      currentDay: 1,
      isFinished: false,
      totalReps: 0,
      daysCompleted: 0,
      completionPercent: 0,
      repsPercent: 0,
    });
    expect(stats.today.target).toBe(20);
  });

  it('excludes rest days from the completion denominator, so 100% is reachable', () => {
    const challenge = completeThrough(CHALLENGE_LENGTH);
    expect(daysCompleted(challenge)).toBe(ACTIVE_DAY_COUNT);
    expect(getStats(challenge, '2026-01-30').completionPercent).toBe(100);
  });

  it('does not count rest days as days completed', () => {
    const challenge = completeThrough(7);
    expect(daysCompleted(challenge)).toBe(6);
  });

  it('caps reps progress at 100% when the user overshoots', () => {
    let challenge = fresh();
    for (let day = 1; day <= 30; day += 1) {
      if (getPlannedDay(day).isRest) continue;
      challenge = recordReps(challenge, day, 500).challenge;
    }
    expect(getStats(challenge, '2026-01-30').repsPercent).toBe(100);
  });
});
