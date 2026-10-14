import { useEffect, useState } from 'react';
import { getStats, type Challenge } from '../challenge/engine';
import { buildWorkoutSummary, fetchAdvice } from '../services/coach';
import { useChallengeStore } from '../store/challengeStore';
import { todayKey } from '../utils/date';

const CACHE_KEY = 'squat-challenge/coach';

interface Cached {
  sessionId: string;
  advice: string;
}

function readCache(): Cached | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Cached) : null;
  } catch {
    return null;
  }
}

function writeCache(value: Cached): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the advice just gets fetched again next time.
  }
}

/**
 * Advice on today's workout from the AI coach, shown after a camera set.
 * Fetched once per session and cached, so revisiting Home costs nothing.
 * Hidden entirely when offline or the coach fails: it's a bonus, never a blocker.
 */
export function CoachCard({ challenge }: { challenge: Challenge }) {
  const sessions = useChallengeStore((s) => s.sessions);
  const day = getStats(challenge, todayKey()).today.day;

  // Sessions are stored newest first.
  const latest = sessions.find((s) => s.day === day && s.source === 'camera' && s.reps > 0);
  const sessionId = latest?.id;
  const cached = readCache();
  const hit = sessionId && cached?.sessionId === sessionId ? cached.advice : null;

  // The result for whichever session was last requested; a different id means loading.
  const [result, setResult] = useState<{ sessionId: string; advice: string | null } | null>(null);
  // Only a new session triggers a request. The summary is read from the store at
  // that moment, so unrelated store updates don't re-send it.
  useEffect(() => {
    const { challenge: saved, sessions: all } = useChallengeStore.getState();
    if (!sessionId || hit || !saved || !navigator.onLine) return;
    const controller = new AbortController();
    fetchAdvice(buildWorkoutSummary(saved, all, todayKey()), controller.signal)
      .then(({ advice }) => {
        writeCache({ sessionId, advice });
        setResult({ sessionId, advice });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ sessionId, advice: null });
      });
    return () => controller.abort();
  }, [sessionId, hit]);

  if (!sessionId) return null;
  const settled = result?.sessionId === sessionId;
  const advice = hit ?? (settled ? result.advice : null);
  // A failed request settles with no advice: hide rather than show an error.
  if ((settled && !advice) || (!advice && !navigator.onLine)) return null;

  return (
    <div className="card" aria-live="polite">
      <p className="eyebrow" style={{ marginBottom: 8 }}>
        Coach
      </p>
      {advice ? (
        <p style={{ margin: 0, lineHeight: 1.55 }}>{advice}</p>
      ) : (
        <p className="muted" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="spinner spinner--sm" />
          Reviewing your set…
        </p>
      )}
      <p className="muted" style={{ margin: '10px 0 0', fontSize: '0.75rem' }}>
        AI advice from NVIDIA Nemotron. Not medical advice.
      </p>
    </div>
  );
}
