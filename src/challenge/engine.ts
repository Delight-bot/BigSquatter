/**
 * Challenge state and the pure functions that advance it.
 *
 * This layer knows nothing about computer vision — it accepts a rep count from
 * wherever (the camera, or the manual counter used as a fallback) and owns the
 * calendar, targets, completion and stats. Keeping the two halves independent is
 * what lets the app be a working product even if pose detection is unavailable
 * on a given device.
 *
 * Day numbering is date-driven, not action-driven: day N is always the Nth
 * calendar day from the start date. Skipping a day therefore leaves it
 * permanently incomplete, which is exactly what makes a streak mean something.
 */

import { addDays, daysBetween, todayKey, type DateKey } from '../utils/date';
import {
  ACTIVE_DAY_COUNT,
  CHALLENGE_LENGTH,
  getPlannedDay,
  TOTAL_PLANNED_REPS,
} from './plan';

export interface DayProgress {
  day: number;
  dateKey: DateKey;
  target: number;
  isRest: boolean;
  completedReps: number;
  completed: boolean;
  /** ISO instant the day's target was first met. */
  completedAt: string | null;
}

export interface Challenge {
  id: string;
  startDate: DateKey;
  /** Sparse: only days the user has actually touched are stored. */
  days: Record<number, DayProgress>;
}

export interface ChallengeStats {
  currentDay: number;
  /** True once the calendar has moved past day 30. */
  isFinished: boolean;
  today: DayProgress;
  totalReps: number;
  daysCompleted: number;
  /** Completion by active (non-rest) days, 0..100. */
  completionPercent: number;
  /** Completion by reps against the whole plan, 0..100. */
  repsPercent: number;
}

export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createChallenge(startDate: DateKey = todayKey(), id = createId()): Challenge {
  return { id, startDate, days: {} };
}

export function dateKeyForDay(challenge: Challenge, day: number): DateKey {
  return addDays(challenge.startDate, day - 1);
}

/**
 * The day number the calendar is on. Clamped into 1..30 for display; use
 * {@link isFinished} to tell a genuinely-finished challenge from day 30.
 */
export function currentDay(challenge: Challenge, today: DateKey = todayKey()): number {
  const raw = daysBetween(challenge.startDate, today) + 1;
  return Math.min(CHALLENGE_LENGTH, Math.max(1, raw));
}

export function isFinished(challenge: Challenge, today: DateKey = todayKey()): boolean {
  return daysBetween(challenge.startDate, today) + 1 > CHALLENGE_LENGTH;
}

/** Stored progress for a day, or a zeroed record derived from the plan. */
export function getDayProgress(challenge: Challenge, day: number): DayProgress {
  const stored = challenge.days[day];
  if (stored) return stored;
  const planned = getPlannedDay(day);
  return {
    day,
    dateKey: dateKeyForDay(challenge, day),
    target: planned.target,
    isRest: planned.isRest,
    completedReps: 0,
    // A rest day needs no reps, so it counts as complete from the outset.
    completed: planned.isRest,
    completedAt: null,
  };
}

export interface RecordRepsResult {
  challenge: Challenge;
  day: DayProgress;
  /** True only on the update that pushes the day from incomplete to complete. */
  justCompleted: boolean;
}

/**
 * Adds reps to a day. Immutable: returns a new challenge rather than mutating.
 *
 * @param reps reps to add; must be a non-negative integer.
 */
export function recordReps(
  challenge: Challenge,
  day: number,
  reps: number,
  now: Date = new Date(),
): RecordRepsResult {
  if (!Number.isInteger(reps) || reps < 0) {
    throw new RangeError(`reps must be a non-negative integer, got ${reps}`);
  }
  const previous = getDayProgress(challenge, day);
  const completedReps = previous.completedReps + reps;
  // Rest days are already complete; extra reps are logged but change nothing.
  const completed = previous.isRest || completedReps >= previous.target;
  const justCompleted = completed && !previous.completed;

  const updated: DayProgress = {
    ...previous,
    completedReps,
    completed,
    completedAt: justCompleted ? now.toISOString() : previous.completedAt,
  };

  return {
    challenge: { ...challenge, days: { ...challenge.days, [day]: updated } },
    day: updated,
    justCompleted,
  };
}

export function totalReps(challenge: Challenge): number {
  return Object.values(challenge.days).reduce((sum, d) => sum + d.completedReps, 0);
}

/** Non-rest days whose target has been met. */
export function daysCompleted(challenge: Challenge): number {
  return Object.values(challenge.days).filter((d) => d.completed && !d.isRest).length;
}

export function getStats(challenge: Challenge, today: DateKey = todayKey()): ChallengeStats {
  const day = currentDay(challenge, today);
  const reps = totalReps(challenge);
  const done = daysCompleted(challenge);
  return {
    currentDay: day,
    isFinished: isFinished(challenge, today),
    today: getDayProgress(challenge, day),
    totalReps: reps,
    daysCompleted: done,
    completionPercent: Math.round((done / ACTIVE_DAY_COUNT) * 100),
    repsPercent: Math.min(100, Math.round((reps / TOTAL_PLANNED_REPS) * 100)),
  };
}
