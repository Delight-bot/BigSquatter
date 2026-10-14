/**
 * Live versus: two people, two phones, a 60-second squat sprint.
 *
 * Each phone counts its own reps with its own camera and streams just the
 * count to the other. Reps done in a match also count toward today's
 * challenge, committed one at a time as they happen (same as the workout
 * screen), so a dropped connection never costs anyone their work.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { averageDepthPercent } from '../cv/formFeedback';
import { handsUp, HoldTimer } from '../cv/gestures';
import { useSquatSession, type FrameInfo } from '../cv/useSquatSession';
import { useChallengeStore } from '../store/challengeStore';
import { formatDuration } from '../utils/date';
import { blip, goalFeedback, repFeedback } from '../utils/feedbackFx';
import { outcome, secondsLeft, type MatchState } from '../versus/match';
import { CODE_LENGTH, inviteLink, normaliseCode, type TransportError } from '../versus/transport';
import { useVersusMatch, type UseVersusMatch } from '../versus/useVersusMatch';

export function Versus() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const versus = useVersusMatch();
  const { match, error, leave } = versus;

  const exit = useCallback(() => {
    leave();
    navigate('/', { replace: true });
  }, [leave, navigate]);

  if (error) return <ErrorView error={error} onBack={leave} />;
  if (!match) {
    return (
      <Setup
        initialCode={params.get('join') ?? ''}
        onHost={versus.host}
        onJoin={versus.join}
        onBack={() => navigate('/', { replace: true })}
      />
    );
  }
  if (match.phase === 'waiting') {
    return <Waiting role={match.role} code={versus.code ?? ''} onCancel={leave} />;
  }
  return <Arena versus={versus} match={match} onExit={exit} />;
}

/* ---------- Before the match ---------- */

function Setup({
  initialCode,
  onHost,
  onJoin,
  onBack,
}: {
  initialCode: string;
  onHost: (name: string) => void;
  onJoin: (code: string, name: string) => void;
  onBack: () => void;
}) {
  const storedName = useChallengeStore((s) => s.name);
  const [name, setName] = useState(storedName);
  const [code, setCode] = useState(initialCode.toUpperCase().slice(0, CODE_LENGTH));
  const validCode = normaliseCode(code);
  const hasName = name.trim().length > 0;

  // A friend arriving from an invite link may not have onboarded; remember the
  // name they type so the next match doesn't ask again.
  const saveName = () => {
    if (name.trim() !== storedName) useChallengeStore.setState({ name: name.trim() });
  };

  return (
    <div className="screen stack--lg">
      <div>
        <p className="eyebrow">Live versus</p>
        <h1 style={{ fontSize: '1.6rem' }}>Squat off against a friend</h1>
        <p className="muted" style={{ marginBottom: 0 }}>
          60 seconds, two phones, most squats wins. Each phone counts its own reps and shares only
          the number. No video leaves either phone.
        </p>
      </div>

      <div className="card stack">
        <label className="field">
          <span className="field__label">Your name</span>
          <input
            type="text"
            value={name}
            maxLength={24}
            autoComplete="nickname"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      </div>

      <div className="card stack">
        <h2 style={{ fontSize: '1rem' }}>Start a match</h2>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>
          You'll get a code to send your friend.
        </p>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!hasName}
          onClick={() => {
            saveName();
            onHost(name);
          }}
        >
          Create match
        </button>
      </div>

      <div className="card stack">
        <h2 style={{ fontSize: '1rem' }}>Join a match</h2>
        <label className="field">
          <span className="field__label">Match code</span>
          <input
            type="text"
            className="versus-code-input"
            value={code}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="ABCDE"
            onChange={(e) =>
              setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH))
            }
          />
        </label>
        <button
          type="button"
          className="btn"
          disabled={!hasName || !validCode}
          onClick={() => {
            if (!validCode) return;
            saveName();
            onJoin(validCode, name);
          }}
        >
          Join
        </button>
      </div>

      <button type="button" className="btn btn--ghost btn--sm" onClick={onBack}>
        Back
      </button>
    </div>
  );
}

function Waiting({
  role,
  code,
  onCancel,
}: {
  role: MatchState['role'];
  code: string;
  onCancel: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = inviteLink(code);
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Squat off?', text: `Join my squat match: ${code}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // The user dismissed the share sheet; nothing to do.
    }
  };

  if (role === 'guest') {
    return (
      <div className="screen versus-center stack">
        <span className="spinner" />
        <p className="muted">Connecting to match {code}…</p>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="screen versus-center stack--lg">
      <div>
        <p className="eyebrow">Your match code</p>
        <p className="versus-code" aria-label={`Match code ${[...code].join(' ')}`}>
          {code}
        </p>
      </div>
      <p className="muted">
        Your friend opens the app, taps <strong>Versus</strong>, and enters this code. Or send them
        the link.
      </p>
      <div className="stack" style={{ width: '100%', maxWidth: 320 }}>
        <button type="button" className="btn btn--primary" onClick={() => void share()}>
          {copied ? 'Link copied' : 'Send invite link'}
        </button>
        <div className="row" style={{ justifyContent: 'center' }}>
          <span className="spinner spinner--sm" />
          <span className="muted" style={{ fontSize: '0.875rem' }}>
            Waiting for your friend…
          </span>
        </div>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const ERROR_COPY: Record<TransportError, { title: string; body: string }> = {
  'no-match': {
    title: 'No match with that code',
    body: 'Check the code with your friend. Their match screen needs to stay open while you join.',
  },
  'code-taken': {
    title: 'Code already in use',
    body: 'Try creating the match again.',
  },
  unsupported: {
    title: 'Not supported here',
    body: "This browser can't make a direct connection. Try an up-to-date Chrome or Safari.",
  },
  network: {
    title: "Couldn't connect",
    body: 'Some networks block direct connections between phones. Try switching one phone between Wi-Fi and mobile data.',
  },
};

function ErrorView({ error, onBack }: { error: TransportError; onBack: () => void }) {
  const copy = ERROR_COPY[error];
  return (
    <div className="screen versus-center stack">
      <h2>{copy.title}</h2>
      <p className="muted">{copy.body}</p>
      <button type="button" className="btn btn--primary" style={{ maxWidth: 320 }} onClick={onBack}>
        Try again
      </button>
    </div>
  );
}

/* ---------- The match ---------- */

function Arena({
  versus,
  match,
  onExit,
}: {
  versus: UseVersusMatch;
  match: MatchState;
  onExit: () => void;
}) {
  const settings = useChallengeStore((s) => s.settings);
  const addReps = useChallengeStore((s) => s.addReps);
  const logSession = useChallengeStore((s) => s.logSession);
  const { dispatch, now } = versus;

  const mirrored = settings.cameraFacing === 'user' && settings.mirrorPreview;
  const [pulseKey, setPulseKey] = useState(0);

  // Getting ready without touching the phone: tapping "I'm ready" only arms it,
  // and the ready is sent once the camera has seen you in frame for a moment —
  // so you can tap, then walk back. Raising both hands readies you outright.
  const [armed, setArmed] = useState(false);
  const [handsRaised, setHandsRaised] = useState(false);
  const steadyTimerRef = useRef(new HoldTimer(1_000));
  const handsTimerRef = useRef(new HoldTimer(800));

  // Per-round bookkeeping, reset whenever a new countdown begins.
  const countedRef = useRef(0);
  const depthsRef = useRef<number[]>([]);
  const roundStartRef = useRef('');
  const loggedRef = useRef(false);

  const handleRep = useCallback(
    (rep: { depth: number }) => {
      const after = dispatch({ type: 'rep' });
      // The reducer ignores reps outside the live window; only count what it kept.
      if (!after || after.me.reps <= countedRef.current) return;
      countedRef.current = after.me.reps;
      depthsRef.current.push(rep.depth);
      repFeedback(after.me.reps, settings.soundOn);
      setPulseKey((k) => k + 1);
      if (addReps(1)) goalFeedback(settings.soundOn);
    },
    [addReps, dispatch, settings.soundOn],
  );

  const lobbyIdle = match.phase === 'lobby' && !match.me.ready;
  const handleFrame = useCallback(
    ({ landmarks, framingReady, now: frameNow }: FrameInfo) => {
      if (!lobbyIdle) return;
      // Whole body in frame as well, so arms raised while walking up close don't count.
      const raised = framingReady && handsUp(landmarks);
      setHandsRaised((was) => (was === raised ? was : raised));
      const byGesture = handsTimerRef.current.update(raised, frameNow);
      const bySteady = armed && steadyTimerRef.current.update(framingReady, frameNow);
      if (byGesture || bySteady) {
        dispatch({ type: 'set-ready', ready: true });
        setArmed(false);
      }
    },
    [armed, dispatch, lobbyIdle],
  );

  const session = useSquatSession({
    facingMode: settings.cameraFacing,
    mirrored,
    showSkeleton: settings.showSkeleton,
    onRep: handleRep,
    onFrame: handleFrame,
  });
  const { snapshot, status, videoRef, canvasRef, error: cameraError } = session;
  const cameraOn = status === 'running';

  const { phase, me, opponent } = match;
  const opponentName = opponent?.name ?? 'Friend';
  const seconds = secondsLeft(match, now);

  useEffect(() => {
    // `armed` needs no reset: leaving the lobby requires being ready, and
    // readying clears it. The hold timers are refs, so they do.
    if (phase !== 'lobby') return;
    steadyTimerRef.current.reset();
    handsTimerRef.current.reset();
  }, [phase]);

  useEffect(() => {
    if (phase !== 'countdown') return;
    countedRef.current = 0;
    depthsRef.current = [];
    roundStartRef.current = new Date().toISOString();
    loggedRef.current = false;
  }, [phase]);

  // Countdown beeps, then a higher one for "go".
  useEffect(() => {
    if (!settings.soundOn) return;
    if (phase === 'countdown' && seconds > 0) blip(660, 120);
    if (phase === 'live' && seconds === Math.ceil(match.durationMs / 1000)) blip(990, 220);
  }, [match.durationMs, phase, seconds, settings.soundOn]);

  // One history entry per round, written when the round ends however it ends.
  useEffect(() => {
    const roundOver = phase === 'awaiting-final' || phase === 'finished' || phase === 'abandoned';
    if (!roundOver || loggedRef.current || countedRef.current === 0) return;
    loggedRef.current = true;
    logSession({
      startedAt: roundStartRef.current,
      endedAt: new Date().toISOString(),
      reps: countedRef.current,
      durationMs: match.durationMs,
      averageDepthPercent: averageDepthPercent(depthsRef.current),
      source: 'camera',
    });
  }, [logSession, match.durationMs, phase]);

  const lead = me.reps - (opponent?.reps ?? 0);

  return (
    <div className="camera">
      <div className="camera__stage">
        <video
          ref={videoRef}
          className={mirrored ? 'camera__video camera__video--mirrored' : 'camera__video'}
          playsInline
          muted
          autoPlay
        />
        <canvas ref={canvasRef} className="camera__overlay" />

        {cameraOn && (
          <div className="camera__hud">
            <div className="versus-board">
              <Score label="You" name={me.name} reps={me.reps} ready={me.ready} phase={phase} mine />
              <div className="versus-board__clock">
                {phase === 'live' ? formatDuration(seconds * 1000) : 'VS'}
              </div>
              <Score
                label="Them"
                name={opponentName}
                reps={opponent?.reps ?? 0}
                ready={opponent?.ready ?? false}
                phase={phase}
              />
            </div>

            {phase === 'countdown' && (
              <div className="versus-countdown" key={seconds}>
                {seconds > 0 ? seconds : 'GO'}
              </div>
            )}

            {phase === 'live' && (
              <div className="camera__count camera__count--pulse">
                <strong key={pulseKey}>{me.reps}</strong>
                <span>{lead > 0 ? `${lead} ahead` : lead < 0 ? `${-lead} behind` : 'Level'}</span>
              </div>
            )}

            <div className="camera__coach" aria-live="polite">
              {phase === 'lobby'
                ? lobbyMessage({
                    meReady: me.ready,
                    opponentReady: opponent?.ready ?? false,
                    opponentName,
                    armed,
                    handsRaised,
                    framingReady: snapshot.framingReady,
                    framingMessage: snapshot.message,
                  })
                : phase === 'awaiting-final'
                  ? `Time! Getting ${opponentName}'s final count…`
                  : snapshot.message}
            </div>

            <div className="camera__bottom">
              {phase === 'lobby' && (
                <div className="btn-row">
                  <button type="button" className="btn btn--ghost btn--sm" onClick={onExit}>
                    Leave
                  </button>
                  <button
                    type="button"
                    className={me.ready || armed ? 'btn btn--sm' : 'btn btn--primary btn--sm'}
                    onClick={() => {
                      if (me.ready) dispatch({ type: 'set-ready', ready: false });
                      else {
                        steadyTimerRef.current.reset();
                        setArmed(!armed);
                      }
                    }}
                  >
                    {me.ready ? 'Not ready' : armed ? 'Cancel' : "I'm ready"}
                  </button>
                </div>
              )}
              {phase === 'live' && (
                <div className="depth">
                  <span>Depth</span>
                  <span className="depth__track">
                    <span className="depth__fill" style={{ width: `${snapshot.depth * 100}%` }} />
                    <span className="depth__target" style={{ left: 'calc(100% - 2px)' }} />
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {status === 'idle' && phase === 'lobby' && (
          <div className="camera__state stack">
            <p className="eyebrow">Matched with {opponentName}</p>
            <h2>Prop your phone up</h2>
            <p className="muted">
              Step back until your whole body is in frame, then raise both hands above your head
              to get ready. When you're both ready, a 3-second countdown starts the sprint.
            </p>
            <div className="stack" style={{ width: '100%', maxWidth: 320 }}>
              <button type="button" className="btn btn--primary" onClick={() => void session.start()}>
                Turn on camera
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={onExit}>
                Leave match
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
              <button type="button" className="btn btn--primary" onClick={() => void session.start()}>
                Try again
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={onExit}>
                Leave match
              </button>
            </div>
          </div>
        )}
      </div>

      {phase === 'finished' && (
        <Result match={match} onRematch={() => dispatch({ type: 'rematch' })} onDone={onExit} />
      )}

      {phase === 'abandoned' && (
        <div className="celebration" role="dialog" aria-modal="true" aria-label="Match ended">
          <h2>{match.endReason === 'version' ? 'Update needed' : `${opponentName} left`}</h2>
          <p className="muted">
            {match.endReason === 'version'
              ? "You're on different versions of the app. Both of you reload the page and try again."
              : me.reps > 0
                ? `The match is off, but your ${me.reps} squats still count toward today.`
                : 'The connection dropped before the match finished.'}
          </p>
          <div className="celebration__actions">
            <button type="button" className="btn btn--primary" onClick={onExit}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function lobbyMessage(s: {
  meReady: boolean;
  opponentReady: boolean;
  opponentName: string;
  armed: boolean;
  handsRaised: boolean;
  framingReady: boolean;
  framingMessage: string;
}): string {
  if (s.meReady) {
    return s.opponentReady ? 'Starting…' : `You're ready. Waiting for ${s.opponentName}…`;
  }
  if (s.handsRaised) return 'Keep your hands up…';
  if (s.armed) {
    return s.framingReady
      ? 'Hold still…'
      : "Step back until you're fully in frame. You'll be marked ready automatically.";
  }
  if (!s.framingReady) return s.framingMessage;
  return 'Raise both hands above your head to get ready 🙌';
}

function Score({
  label,
  name,
  reps,
  ready,
  phase,
  mine = false,
}: {
  label: string;
  name: string;
  reps: number;
  ready: boolean;
  phase: MatchState['phase'];
  mine?: boolean;
}) {
  return (
    <div className={mine ? 'versus-score versus-score--mine' : 'versus-score'}>
      <span className="versus-score__name" title={name}>
        {mine ? label : name}
      </span>
      {phase === 'lobby' ? (
        <span className={ready ? 'pill pill--ok' : 'pill'}>{ready ? 'READY' : 'NOT READY'}</span>
      ) : (
        <strong>{reps}</strong>
      )}
    </div>
  );
}

const RESULT_COPY = {
  win: { mark: '🏆', title: 'You win!' },
  lose: { mark: '💪', title: '' },
  draw: { mark: '🤝', title: "It's a draw" },
} as const;

function Result({
  match,
  onRematch,
  onDone,
}: {
  match: MatchState;
  onRematch: () => void;
  onDone: () => void;
}) {
  const result = outcome(match) ?? 'draw';
  const opponentName = match.opponent?.name ?? 'Friend';
  const copy = RESULT_COPY[result];

  return (
    <div className="celebration" role="dialog" aria-modal="true" aria-label="Match result">
      <span className="celebration__mark" aria-hidden="true">
        {copy.mark}
      </span>
      <p className="eyebrow">{Math.round(match.durationMs / 1000)}-second sprint</p>
      <h2>{result === 'lose' ? `${opponentName} wins` : copy.title}</h2>
      <p className="versus-final">
        <span className="versus-final--mine">{match.me.reps}</span>
        <span className="muted">–</span>
        <span>{match.opponent?.reps ?? 0}</span>
      </p>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Your squats count toward today's challenge.
      </p>
      <div className="celebration__actions stack">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!match.opponentConnected}
          onClick={onRematch}
        >
          {match.opponentConnected ? 'Rematch' : `${opponentName} left`}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
