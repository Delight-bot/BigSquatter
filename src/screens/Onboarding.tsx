import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CHALLENGE_PLAN, TOTAL_PLANNED_REPS } from '../challenge/plan';
import { useChallengeStore } from '../store/challengeStore';

export function Onboarding() {
  const startChallenge = useChallengeStore((s) => s.startChallenge);
  const savedName = useChallengeStore((s) => s.name);
  const [name, setName] = useState(savedName);
  const navigate = useNavigate();

  const firstDay = CHALLENGE_PLAN[0].target;
  const lastDay = CHALLENGE_PLAN[CHALLENGE_PLAN.length - 1].target;

  return (
    <div className="screen stack--lg">
      <div>
        <p className="eyebrow">30-day challenge</p>
        <h1 style={{ fontSize: '2.1rem', lineHeight: 1.1 }}>
          Squats,
          <br />
          counted for you.
        </h1>
        <p className="muted" style={{ marginTop: 10, lineHeight: 1.5 }}>
          Prop up your phone, step back, and squat. The camera tracks your body, checks your depth
          and counts every rep — all on this device. No video is recorded or uploaded.
        </p>
      </div>

      <div className="card stack">
        <div className="row">
          <span className="stat__label">Day 1</span>
          <strong>{firstDay} squats</strong>
        </div>
        <div className="row">
          <span className="stat__label">Day 30</span>
          <strong>{lastDay} squats</strong>
        </div>
        <div className="row">
          <span className="stat__label">Total</span>
          <strong>{TOTAL_PLANNED_REPS.toLocaleString()} squats</strong>
        </div>
        <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
          One rest day every week. Miss a day and your streak resets — the plan doesn't.
        </p>
      </div>

      <label className="field">
        <span className="field__label">What should we call you?</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Optional"
          autoComplete="given-name"
          maxLength={40}
        />
      </label>

      <button
        type="button"
        className="btn btn--primary"
        onClick={() => {
          startChallenge(name);
          navigate('/', { replace: true });
        }}
      >
        Start day 1 today
      </button>
    </div>
  );
}
