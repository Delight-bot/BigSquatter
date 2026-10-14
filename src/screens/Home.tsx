import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getStats } from '../challenge/engine';
import { computeStreak } from '../challenge/streak';
import { CHALLENGE_LENGTH } from '../challenge/plan';
import { CameraIcon } from '../components/Icons';
import { ProgressBar } from '../components/ProgressBar';
import { StatTile } from '../components/StatTile';
import { useChallengeStore } from '../store/challengeStore';
import { todayKey } from '../utils/date';
import type { Challenge } from '../challenge/engine';

interface HomeProps {
  challenge: Challenge;
}

export function Home({ challenge }: HomeProps) {
  const name = useChallengeStore((s) => s.name);
  const addReps = useChallengeStore((s) => s.addReps);
  const logSession = useChallengeStore((s) => s.logSession);
  const [manualOpen, setManualOpen] = useState(false);

  const today = todayKey();
  const { stats, streak } = useMemo(
    () => ({ stats: getStats(challenge, today), streak: computeStreak(challenge, today) }),
    [challenge, today],
  );

  const { today: day } = stats;
  const remaining = Math.max(0, day.target - day.completedReps);
  const dayPercent = day.isRest
    ? 100
    : Math.min(100, (day.completedReps / Math.max(1, day.target)) * 100);

  return (
    <div className="screen stack--lg">
      <div className="row">
        <div>
          <p className="eyebrow">
            Day {day.day} / {CHALLENGE_LENGTH}
          </p>
          <h1 style={{ fontSize: '1.5rem' }}>
            {name ? `Let's go, ${name}.` : stats.isFinished ? 'Challenge complete.' : "Today's set"}
          </h1>
        </div>
        <span className="pill" title="Consecutive days completed">
          🔥 {streak.current}
        </span>
      </div>

      <div className="hero">
        <p className="eyebrow" style={{ marginBottom: 6 }}>
          {day.isRest ? 'Rest day' : day.completed ? 'Target hit' : "Today's goal"}
        </p>
        {day.isRest ? (
          <>
            <span className="hero__target" style={{ fontSize: '3rem' }}>
              REST
            </span>
            <p className="muted" style={{ marginTop: 6 }}>
              Recovery is part of the plan. Come back tomorrow.
            </p>
          </>
        ) : (
          <>
            <span className="hero__target">{day.target}</span>
            <span className="hero__unit">squats</span>
            <div style={{ marginTop: 18 }}>
              <ProgressBar
                percent={dayPercent}
                label={`${day.completedReps} done`}
                done={day.completed}
              />
            </div>
            <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
              {day.completed
                ? 'Day complete. Anything more is a bonus.'
                : `${remaining} to go.`}
            </p>
          </>
        )}
      </div>

      <div className="stack">
        <Link to="/workout" className="btn btn--primary" style={{ textDecoration: 'none' }}>
          <CameraIcon />
          {day.completed ? 'Squat anyway' : day.completedReps > 0 ? 'Continue set' : 'Start challenge'}
        </Link>
        <Link to="/versus" className="btn" style={{ textDecoration: 'none' }}>
          Versus a friend
        </Link>
        {!manualOpen ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setManualOpen(true)}>
            Log squats without the camera
          </button>
        ) : (
          <ManualLog
            onCancel={() => setManualOpen(false)}
            onSubmit={(reps) => {
              addReps(reps);
              logSession({
                startedAt: new Date().toISOString(),
                endedAt: new Date().toISOString(),
                reps,
                durationMs: 0,
                averageDepthPercent: 0,
                source: 'manual',
              });
              setManualOpen(false);
            }}
          />
        )}
      </div>

      <div className="stat-grid">
        <StatTile label="Current streak" value={`${streak.current}d`} accent="streak" />
        <StatTile label="Longest streak" value={`${streak.longest}d`} />
        <StatTile label="Days done" value={stats.daysCompleted} />
        <StatTile label="Total squats" value={stats.totalReps.toLocaleString()} />
      </div>

      <div className="card">
        <ProgressBar
          percent={stats.completionPercent}
          label="Challenge progress"
          done={stats.completionPercent >= 100}
        />
      </div>
    </div>
  );
}

function ManualLog({
  onSubmit,
  onCancel,
}: {
  onSubmit: (reps: number) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('10');
  const reps = Number.parseInt(value, 10);
  const valid = Number.isInteger(reps) && reps > 0 && reps <= 500;

  return (
    <div className="card stack">
      <label className="field">
        <span className="field__label">Squats to add</span>
        <input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
          aria-label="Squats to add"
        />
      </label>
      <div className="btn-row">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={!valid}
          onClick={() => valid && onSubmit(reps)}
        >
          Add
        </button>
      </div>
    </div>
  );
}
