import { describe, expect, it } from 'vitest';
import { createChallenge, recordReps, type Challenge } from '../challenge/engine';
import { getPlannedDay } from '../challenge/plan';
import type { WorkoutSession } from '../store/challengeStore';
import { buildWorkoutSummary } from './coach';

const START = '2026-01-01';
const on = (day: number) => `2026-01-${String(day).padStart(2, '0')}`;

function withDays(...days: number[]): Challenge {
  let challenge = createChallenge(START, 'coach-test');
  for (const day of days) {
    challenge = recordReps(challenge, day, getPlannedDay(day).target).challenge;
  }
  return challenge;
}

function session(day: number, reps: number, depth: number, source: WorkoutSession['source'] = 'camera'): WorkoutSession {
  return {
    id: `${day}-${reps}-${source}`,
    day,
    startedAt: '',
    endedAt: '',
    reps,
    durationMs: 61_400,
    averageDepthPercent: depth,
    source,
  };
}

describe('buildWorkoutSummary', () => {
  it('reports today against the plan, with streaks', () => {
    let challenge = withDays(1, 2);
    challenge = recordReps(challenge, 3, 12).challenge;
    expect(buildWorkoutSummary(challenge, [], on(3))).toMatchObject({
      day: 3,
      target: getPlannedDay(3).target,
      reps_today: 12,
      current_streak: 2,
      longest_streak: 2,
      missed_yesterday: false,
    });
  });

  it('flags a missed day but not a rest day', () => {
    expect(buildWorkoutSummary(withDays(1), [], on(3)).missed_yesterday).toBe(true);
    // Day 7 is a rest day, so day 8 has nothing missed.
    expect(buildWorkoutSummary(withDays(1, 2, 3, 4, 5, 6), [], on(8)).missed_yesterday).toBe(false);
  });

  it('sends a null target on rest days', () => {
    expect(buildWorkoutSummary(withDays(), [], on(7)).target).toBeNull();
  });

  it("sends only today's camera sets, since manual logs have no depth", () => {
    const sessions = [session(3, 20, 81.6), session(3, 10, 0, 'manual'), session(2, 25, 90)];
    expect(buildWorkoutSummary(withDays(), sessions, on(3)).sessions_today).toEqual([
      { reps: 20, average_depth_percent: 82, duration_seconds: 61 },
    ]);
  });
});
