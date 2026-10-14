/**
 * Streak arithmetic.
 *
 * Three rules, chosen so the number feels fair rather than punishing:
 *
 *  1. A rest day never breaks a streak, but it doesn't add to it either — the
 *     streak counts days you actually squatted.
 *  2. Today doesn't break a streak while it is still in progress. Only once the
 *     calendar moves on does an unfinished day count as a miss.
 *  3. Any other unfinished day breaks the streak.
 */

import { getPlannedDay } from './plan';
import { currentDay, getDayProgress, type Challenge } from './engine';
import { todayKey, type DateKey } from '../utils/date';

export interface StreakSummary {
  current: number;
  longest: number;
}

/** A day is "satisfied" when it needed no reps or its target was met. */
function isSatisfied(challenge: Challenge, day: number): boolean {
  if (getPlannedDay(day).isRest) return true;
  return getDayProgress(challenge, day).completed;
}

function countsTowardStreak(day: number): boolean {
  return !getPlannedDay(day).isRest;
}

export function computeStreak(
  challenge: Challenge,
  today: DateKey = todayKey(),
): StreakSummary {
  const day = currentDay(challenge, today);

  // Rule 2: if today isn't done yet, judge the streak as of yesterday.
  const lastJudged = isSatisfied(challenge, day) ? day : day - 1;

  let current = 0;
  for (let d = lastJudged; d >= 1; d -= 1) {
    if (!isSatisfied(challenge, d)) break;
    if (countsTowardStreak(d)) current += 1;
  }

  let longest = 0;
  let run = 0;
  for (let d = 1; d <= lastJudged; d += 1) {
    if (isSatisfied(challenge, d)) {
      if (countsTowardStreak(d)) run += 1;
    } else {
      run = 0;
    }
    longest = Math.max(longest, run);
  }

  return { current, longest: Math.max(longest, current) };
}
