/**
 * Client for the AI coach (coach/ in the repo: RAG + NVIDIA Nemotron via NIM).
 *
 * Only numbers leave the phone: the day, reps against target, rep depth and
 * the streak. In production the app calls `/api/coach` on its own origin, which
 * CloudFront forwards to API Gateway, so there is no API URL to configure.
 * `VITE_COACH_URL` points development builds at a local `uvicorn coach.api:app`.
 */

import { getDayProgress, getStats, type Challenge } from '../challenge/engine';
import { computeStreak } from '../challenge/streak';
import type { WorkoutSession } from '../store/challengeStore';
import type { DateKey } from '../utils/date';

/** Mirrors `WorkoutSummary` in coach/src/coach/workout.py. */
export interface WorkoutSummary {
  day: number;
  target: number | null;
  reps_today: number;
  current_streak: number;
  longest_streak: number;
  missed_yesterday: boolean;
  sessions_today: { reps: number; average_depth_percent: number; duration_seconds: number }[];
}

export interface CoachAdvice {
  advice: string;
  sources: { source: string; heading: string; score: number }[];
}

export function buildWorkoutSummary(
  challenge: Challenge,
  sessions: readonly WorkoutSession[],
  today: DateKey,
): WorkoutSummary {
  const { today: day } = getStats(challenge, today);
  const streak = computeStreak(challenge, today);
  // Rest days count as satisfied, so only a real missed workout reads as a miss.
  const missedYesterday = day.day > 1 && !getDayProgress(challenge, day.day - 1).completed;

  return {
    day: day.day,
    target: day.isRest ? null : day.target,
    reps_today: day.completedReps,
    current_streak: streak.current,
    longest_streak: streak.longest,
    missed_yesterday: missedYesterday,
    // Manual logs have no depth reading, so sending them would look like shallow reps.
    sessions_today: sessions
      .filter((s) => s.day === day.day && s.source === 'camera' && s.reps > 0)
      .map((s) => ({
        reps: s.reps,
        average_depth_percent: Math.max(0, Math.min(100, Math.round(s.averageDepthPercent))),
        duration_seconds: Math.round(s.durationMs / 1000),
      })),
  };
}

export async function fetchAdvice(summary: WorkoutSummary, signal?: AbortSignal): Promise<CoachAdvice> {
  const base = import.meta.env.VITE_COACH_URL ?? '';
  const response = await fetch(`${base}/api/coach`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(summary),
    signal,
  });
  if (!response.ok) throw new Error(`Coach returned ${response.status}`);
  return (await response.json()) as CoachAdvice;
}
