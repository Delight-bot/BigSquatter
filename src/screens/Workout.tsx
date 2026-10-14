/**
 * The camera screen.
 *
 * Reps are committed to the store one at a time rather than in a batch at the
 * end: someone mid-set who gets a phone call, or whose browser reclaims the tab,
 * should not lose the work they already did.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStats, type Challenge } from '../challenge/engine';
import { computeStreak } from '../challenge/streak';
import { averageDepthPercent } from '../cv/formFeedback';
import { useSquatSession } from '../cv/useSquatSession';
import { Celebration } from '../components/Celebration';
import { useChallengeStore } from '../store/challengeStore';
import { formatDuration, todayKey } from '../utils/date';
import { goalFeedback, repFeedback } from '../utils/feedbackFx';

interface WorkoutProps {
  challenge: Challenge;
}

export function Workout({ challenge }: WorkoutProps) {
  const navigate = useNavigate();
  const settings = useChallengeStore((s) => s.settings);
  const addReps = useChallengeStore((s) => s.addReps);
  const logSession = useChallengeStore((s) => s.logSession);

  const today = todayKey();
  // `challenge` is live from the store and changes on every counted rep, so it is
  // the source of truth for the displayed total — never added to a second count.
  const stats = useMemo(() => getStats(challenge, today), [challenge, today]);
  const target = stats.today.isRest ? 0 : stats.today.target;

  /** Reps committed during *this* session, including manual +1 taps. */
  const sessionRepsRef = useRef(0);
  const depthsRef = useRef<number[]>([]);
  // Both are set in `begin()`; nothing reads them before a session starts.
  const startedAtRef = useRef<string>('');
  const startedMsRef = useRef<number>(0);
  const [celebrated, setCelebrated] = useState<{ reps: number; durationMs: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [pulseKey, setPulseKey] = useState(0);

  const mirrored = settings.cameraFacing === 'user' && settings.mirrorPreview;

  const handleRep = useCallback(
    (rep: { depth: number }) => {
      depthsRef.current.push(rep.depth);
      sessionRepsRef.current += 1;
      repFeedback(sessionRepsRef.current, settings.soundOn);
      setPulseKey((k) => k + 1);
      const justCompleted = addReps(1);
      if (justCompleted) {
        goalFeedback(settings.soundOn);
        // Read back from the store so the number shown is the one that was saved.
        const saved = useChallengeStore.getState().challenge;
        setCelebrated({
          reps: saved ? getStats(saved, today).today.completedReps : 0,
          durationMs: performance.now() - startedMsRef.current,
        });
      }
    },
    [addReps, settings.soundOn, today],
  );

  const session = useSquatSession({
    facingMode: settings.cameraFacing,
    mirrored,
    showSkeleton: settings.showSkeleton,
    onRep: handleRep,
  });

  const { snapshot, status, videoRef, canvasRef, error: cameraError } = session;
  const running = status === 'running';

  // Session clock. Ticking once a second keeps this off the render-per-frame path.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(
      () => setElapsed(performance.now() - startedMsRef.current),
      1000,
    );
    return () => window.clearInterval(id);
  }, [running]);

  const finish = useCallback(() => {
    const reps = sessionRepsRef.current;
    const durationMs = performance.now() - startedMsRef.current;
    session.stop();
    if (reps > 0) {
      logSession({
        startedAt: startedAtRef.current,
        endedAt: new Date().toISOString(),
        reps,
        durationMs,
        averageDepthPercent: averageDepthPercent(depthsRef.current),
        source: 'camera',
      });
    }
    navigate('/', { replace: true });
  }, [logSession, navigate, session]);

  const begin = useCallback(async () => {
    startedAtRef.current = new Date().toISOString();
    startedMsRef.current = performance.now();
    depthsRef.current = [];
    sessionRepsRef.current = 0;
    await session.start();
  }, [session]);

  const totalToday = stats.today.completedReps;
  const streakAfter = computeStreak(challenge, today).current;

  return (
    <div className="camera">
      <div className="camera__stage">
        <video
          ref={videoRef}
          className={mirrored ? 'camera__video camera__video--mirrored' : 'camera__video'}
          playsInline
          muted
          // Autoplay is driven explicitly in the hook after the user taps Start.
          autoPlay
        />
        <canvas ref={canvasRef} className="camera__overlay" />

        {running && (
          <div className="camera__hud">
            <div className="camera__topbar">
              <span className={snapshot.framingReady ? 'pill pill--ok' : 'pill pill--warn'}>
                {snapshot.framingReady ? '● TRACKING' : '● POSITION'}
              </span>
              <span className="pill">{formatDuration(elapsed)}</span>
            </div>

            <div className={pulseKey > 0 ? 'camera__count camera__count--pulse' : 'camera__count'}>
              <strong key={pulseKey}>{totalToday}</strong>
              {target > 0 && <span>/ {target}</span>}
            </div>

            <div className="camera__coach" aria-live="polite">
              {snapshot.message}
            </div>

            <div className="camera__bottom">
              <div className="depth">
                <span>Depth</span>
                <span className="depth__track">
                  <span className="depth__fill" style={{ width: `${snapshot.depth * 100}%` }} />
                  {/* Marks the depth a rep must reach to count. */}
                  <span className="depth__target" style={{ left: 'calc(100% - 2px)' }} />
                </span>
              </div>
              <div className="camera__controls">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    session.resetCount();
                    sessionRepsRef.current = 0;
                  }}
                  title="Restart the detector without discarding saved reps"
                >
                  Reset
                </button>
                <button
                  type="button"
                  className="btn btn--sm"
                  style={{ minWidth: 64 }}
                  onClick={() => handleRep({ depth: 1 })}
                  title="Count a rep the camera missed"
                >
                  +1
                </button>
                <button type="button" className="btn btn--primary btn--sm" onClick={finish}>
                  Finish
                </button>
              </div>
            </div>
          </div>
        )}

        {status === 'idle' && (
          <div className="camera__state stack">
            <p className="eyebrow">Day {stats.today.day} · set up</p>
            <h2>Prop your phone up</h2>
            <ol
              className="muted"
              style={{ textAlign: 'left', lineHeight: 1.7, paddingLeft: 20, margin: 0 }}
            >
              <li>Lean the phone against something stable.</li>
              <li>Step back until your whole body is in frame.</li>
              <li>Stand up straight, then start squatting.</li>
            </ol>
            <p className="muted" style={{ fontSize: '0.8rem' }}>
              Everything runs on your device. No video leaves the phone.
            </p>
            <div className="stack" style={{ width: '100%', maxWidth: 320 }}>
              <button type="button" className="btn btn--primary" onClick={begin}>
                Turn on camera
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => navigate('/', { replace: true })}
              >
                Back
              </button>
            </div>
          </div>
        )}

        {status === 'loading' && (
          <div className="camera__state">
            <span className="spinner" />
            <p className="muted">Loading the pose model…</p>
          </div>
        )}

        {status === 'error' && (
          <div className="camera__state stack">
            <h2>Camera unavailable</h2>
            <p className="muted">{cameraError}</p>
            <div className="stack" style={{ width: '100%', maxWidth: 320 }}>
              <button type="button" className="btn btn--primary" onClick={begin}>
                Try again
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => navigate('/', { replace: true })}
              >
                Count them manually instead
              </button>
            </div>
          </div>
        )}
      </div>

      {celebrated && (
        <Celebration
          day={stats.today.day}
          reps={celebrated.reps}
          target={target}
          durationMs={celebrated.durationMs}
          streak={streakAfter}
          onDone={finish}
          onKeepGoing={() => setCelebrated(null)}
        />
      )}
    </div>
  );
}
