import { useMemo } from 'react';
import { CalendarGrid } from '../components/CalendarGrid';
import { ProgressBar } from '../components/ProgressBar';
import { StatTile } from '../components/StatTile';
import { getStats, type Challenge } from '../challenge/engine';
import { computeStreak } from '../challenge/streak';
import { CHALLENGE_PLAN, TOTAL_PLANNED_REPS } from '../challenge/plan';
import { useChallengeStore } from '../store/challengeStore';
import { formatDuration, monthLabel, todayKey } from '../utils/date';

interface ProgressProps {
  challenge: Challenge;
}

export function Progress({ challenge }: ProgressProps) {
  const sessions = useChallengeStore((s) => s.sessions);
  const today = todayKey();

  const { stats, streak } = useMemo(
    () => ({ stats: getStats(challenge, today), streak: computeStreak(challenge, today) }),
    [challenge, today],
  );

  const upcoming = useMemo(
    () => CHALLENGE_PLAN.filter((d) => d.day > stats.currentDay).slice(0, 5),
    [stats.currentDay],
  );

  return (
    <div className="screen stack--lg">
      <div>
        <p className="eyebrow">Progress</p>
        <h1 style={{ fontSize: '1.6rem' }}>{monthLabel(challenge.startDate)} challenge</h1>
      </div>

      <div className="stat-grid">
        <StatTile label="Current streak" value={`${streak.current}d`} accent="streak" />
        <StatTile label="Longest streak" value={`${streak.longest}d`} />
        <StatTile label="Total squats" value={stats.totalReps.toLocaleString()} />
        <StatTile label="Days complete" value={`${stats.daysCompleted}`} />
      </div>

      <div className="card stack">
        <ProgressBar
          percent={stats.completionPercent}
          label="Days complete"
          done={stats.completionPercent >= 100}
        />
        <ProgressBar
          percent={stats.repsPercent}
          label={`Squats (${stats.totalReps} / ${TOTAL_PLANNED_REPS})`}
        />
      </div>

      <div className="card">
        <h2 style={{ fontSize: '1rem', marginBottom: 14 }}>Calendar</h2>
        <CalendarGrid challenge={challenge} today={today} />
      </div>

      {upcoming.length > 0 && (
        <div className="card">
          <h2 style={{ fontSize: '1rem', marginBottom: 6 }}>Coming up</h2>
          {upcoming.map((d) => (
            <div key={d.day} className="session">
              <span>Day {d.day}</span>
              <strong>{d.isRest ? 'Rest' : `${d.target} squats`}</strong>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2 style={{ fontSize: '1rem', marginBottom: 6 }}>Recent sessions</h2>
        {sessions.length === 0 ? (
          <p className="muted" style={{ margin: '10px 0 0', fontSize: '0.875rem' }}>
            No sessions yet. Your first set will show up here.
          </p>
        ) : (
          sessions.slice(0, 12).map((s) => (
            <div key={s.id} className="session">
              <span>
                <strong>{s.reps}</strong> squats
                <span className="muted"> · day {s.day}</span>
              </span>
              <span className="muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {s.source === 'camera' ? (
                  <>
                    {formatDuration(s.durationMs)} · {s.averageDepthPercent}% depth
                  </>
                ) : (
                  <span className="badge">manual</span>
                )}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
