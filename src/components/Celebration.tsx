import { formatDuration } from '../utils/date';

interface CelebrationProps {
  day: number;
  reps: number;
  target: number;
  durationMs: number;
  streak: number;
  onDone: () => void;
  onKeepGoing: () => void;
}

export function Celebration({
  day,
  reps,
  target,
  durationMs,
  streak,
  onDone,
  onKeepGoing,
}: CelebrationProps) {
  return (
    <div className="celebration" role="dialog" aria-modal="true" aria-label={`Day ${day} complete`}>
      <span className="celebration__mark" aria-hidden="true">
        🎉
      </span>
      <p className="eyebrow">Day {day} complete</p>
      <h2>
        {reps} / {target} squats
      </h2>
      <p className="muted">
        {formatDuration(durationMs)} · <span className="streak">🔥 {streak} day streak</span>
      </p>
      <div className="celebration__actions stack">
        <button type="button" className="btn btn--primary" onClick={onDone}>
          Done for today
        </button>
        <button type="button" className="btn btn--ghost" onClick={onKeepGoing}>
          Keep squatting
        </button>
      </div>
    </div>
  );
}
