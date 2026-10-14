/**
 * The bridge between the camera loop and React.
 *
 * Design constraint: inference runs at up to 30fps, but re-rendering React 30
 * times a second to move a depth bar wastes the frame budget the model needs.
 * So the loop writes into a ref and this hook publishes a snapshot to React at
 * ~12Hz — except rep count and framing state, which are published the instant
 * they change because the user is waiting on exactly those.
 *
 * The skeleton overlay is drawn straight onto a canvas from inside the loop and
 * never passes through React at all.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { computeJointAngles } from './angles';
import { evaluateFraming, hintMessage, type FramingProblem } from './formFeedback';
import { POSE_CONNECTIONS, type Landmark } from './landmarks';
import { openCamera, PoseEngine, stopStream, type PoseDelegate } from './poseEngine';
import {
  DEFAULT_SQUAT_CONFIG,
  SquatDetector,
  type RepRecord,
  type SquatPhase,
} from './squatDetector';

export type SessionStatus = 'idle' | 'loading' | 'running' | 'error';

export interface SessionSnapshot {
  reps: number;
  phase: SquatPhase;
  /** 0..1 */
  depth: number;
  kneeAngle: number;
  framingReady: boolean;
  framingProblem: FramingProblem | null;
  message: string;
  fps: number;
}

const EMPTY_SNAPSHOT: SessionSnapshot = {
  reps: 0,
  phase: 'unknown',
  depth: 0,
  kneeAngle: Number.NaN,
  framingReady: false,
  framingProblem: 'no-pose',
  message: 'Step into view so the camera can see you.',
  fps: 0,
};

const PUBLISH_INTERVAL_MS = 80;

export interface UseSquatSessionOptions {
  facingMode: 'user' | 'environment';
  mirrored: boolean;
  showSkeleton: boolean;
  /** Called once per counted rep, from inside the frame loop. */
  onRep?: (rep: RepRecord) => void;
  /**
   * Called on every analysed frame, from inside the frame loop. For gesture
   * detection; keep it cheap and don't set React state on every call.
   */
  onFrame?: (frame: FrameInfo) => void;
}

export interface FrameInfo {
  landmarks: Landmark[] | null;
  /** Whether the whole body is in frame well enough to count reps. */
  framingReady: boolean;
  now: number;
}

export interface UseSquatSession {
  status: SessionStatus;
  error: string | null;
  /** Which MediaPipe backend actually initialised, for the debug badge. */
  delegate: PoseDelegate | null;
  snapshot: SessionSnapshot;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  start: () => Promise<void>;
  stop: () => void;
  /** Zeroes the counter without tearing the camera down. */
  resetCount: () => void;
}

export function useSquatSession(options: UseSquatSessionOptions): UseSquatSession {
  const { facingMode, mirrored, showSkeleton, onRep, onFrame } = options;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const engineRef = useRef<PoseEngine | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<SquatDetector>(new SquatDetector());
  const rafRef = useRef<number | null>(null);
  const liveRef = useRef<SessionSnapshot>(EMPTY_SNAPSHOT);
  const lastPublishRef = useRef(0);
  const frameTimesRef = useRef<number[]>([]);

  // Kept in refs so the frame loop always sees the latest values without being
  // torn down and restarted on every parent render. Written in an effect rather
  // than during render, so a discarded render cannot leak into the loop.
  const onRepRef = useRef(onRep);
  const onFrameRef = useRef(onFrame);
  const drawOptionsRef = useRef({ mirrored, showSkeleton });
  useEffect(() => {
    onRepRef.current = onRep;
    onFrameRef.current = onFrame;
    drawOptionsRef.current = { mirrored, showSkeleton };
  }, [mirrored, onFrame, onRep, showSkeleton]);

  const [status, setStatus] = useState<SessionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [delegate, setDelegate] = useState<PoseDelegate | null>(null);
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(EMPTY_SNAPSHOT);

  const publish = useCallback((force: boolean) => {
    const now = performance.now();
    if (!force && now - lastPublishRef.current < PUBLISH_INTERVAL_MS) return;
    lastPublishRef.current = now;
    setSnapshot({ ...liveRef.current });
  }, []);

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    stopStream(streamRef.current);
    streamRef.current = null;
    engineRef.current?.close();
    engineRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus('idle');
  }, []);

  const resetCount = useCallback(() => {
    detectorRef.current.reset();
    liveRef.current = { ...liveRef.current, reps: 0, phase: 'unknown', depth: 0 };
    publish(true);
  }, [publish]);

  const start = useCallback(async () => {
    setError(null);
    setStatus('loading');
    try {
      const [stream, engine] = await Promise.all([openCamera(facingMode), PoseEngine.create()]);
      streamRef.current = stream;
      engineRef.current = engine;
      setDelegate(engine.delegate);

      const video = videoRef.current;
      if (!video) throw new Error('Camera preview is not mounted.');
      video.srcObject = stream;
      video.muted = true;
      await video.play();

      detectorRef.current.reset();
      liveRef.current = { ...EMPTY_SNAPSHOT };
      frameTimesRef.current = [];
      setStatus('running');

      const loop = () => {
        rafRef.current = requestAnimationFrame(loop);
        const currentEngine = engineRef.current;
        const currentVideo = videoRef.current;
        if (!currentEngine || !currentVideo || currentVideo.readyState < 2) return;

        const now = performance.now();
        trackFps(frameTimesRef.current, now);

        const { landmarks } = currentEngine.detect(currentVideo, now);
        const framing = evaluateFraming(landmarks);

        // Gate counting on framing: a half-visible body yields angles that look
        // like squats, so a bad frame must not be able to increment the counter.
        const angles = framing.ready && landmarks ? computeJointAngles(landmarks) : null;
        const update = detectorRef.current.update(angles ? angles.knee : Number.NaN, now);

        const previous = liveRef.current;
        const repChanged = update.reps !== previous.reps;
        const framingChanged =
          framing.ready !== previous.framingReady || framing.problem !== previous.framingProblem;

        const hint = update.hint ? hintMessage(update.hint) : null;
        liveRef.current = {
          reps: update.reps,
          phase: update.phase,
          depth: update.depth,
          kneeAngle: update.angle,
          framingReady: framing.ready,
          framingProblem: framing.problem,
          // Framing trouble always wins: fixing it is a precondition for everything else.
          message: framing.ready ? (hint ?? coachFor(update.phase)) : framing.message,
          fps: frameTimesRef.current.length,
        };

        if (update.completedRep) onRepRef.current?.(update.completedRep);
        onFrameRef.current?.({ landmarks, framingReady: framing.ready, now });
        drawOverlay(canvasRef.current, currentVideo, landmarks, drawOptionsRef.current);
        publish(repChanged || framingChanged || update.hint !== null);
      };

      rafRef.current = requestAnimationFrame(loop);
    } catch (err) {
      stop();
      setStatus('error');
      setError(describeCameraError(err));
    }
  }, [facingMode, publish, stop]);

  // Tear the camera down if the screen unmounts mid-set.
  useEffect(() => stop, [stop]);

  return { status, error, delegate, snapshot, videoRef, canvasRef, start, stop, resetCount };
}

function coachFor(phase: SquatPhase): string {
  switch (phase) {
    case 'descending':
      return 'Down…';
    case 'bottom':
      return 'Hold — now drive up.';
    case 'ascending':
      return 'Up!';
    case 'standing':
      return 'Ready.';
    default:
      return 'Stand up tall to begin.';
  }
}

/** Keeps a rolling one-second window of frame timestamps; its length is the FPS. */
function trackFps(times: number[], now: number): void {
  times.push(now);
  while (times.length > 0 && now - times[0] > 1000) times.shift();
}

interface DrawOptions {
  mirrored: boolean;
  showSkeleton: boolean;
}

function drawOverlay(
  canvas: HTMLCanvasElement | null,
  video: HTMLVideoElement,
  landmarks: Landmark[] | null,
  { mirrored, showSkeleton }: DrawOptions,
): void {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = video.videoWidth || canvas.width;
  const height = video.videoHeight || canvas.height;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  ctx.clearRect(0, 0, width, height);
  if (!showSkeleton || !landmarks) return;

  ctx.save();
  if (mirrored) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }

  const px = (lm: Landmark) => ({ x: lm.x * width, y: lm.y * height });

  ctx.lineWidth = Math.max(2, width / 180);
  ctx.strokeStyle = 'rgba(120, 255, 200, 0.9)';
  ctx.beginPath();
  for (const [a, b] of POSE_CONNECTIONS) {
    const from = landmarks[a];
    const to = landmarks[b];
    if (!from || !to) continue;
    const p1 = px(from);
    const p2 = px(to);
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
  }
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  const radius = Math.max(3, width / 140);
  const drawn = new Set(POSE_CONNECTIONS.flat());
  for (const index of drawn) {
    const lm = landmarks[index];
    if (!lm) continue;
    const p = px(lm);
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function describeCameraError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access was blocked. Allow the camera in your browser settings, then try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No usable camera was found on this device.';
    case 'NotReadableError':
      return 'The camera is already in use by another app. Close it and try again.';
    default:
      return err instanceof Error ? err.message : 'Could not start the camera.';
  }
}

export { DEFAULT_SQUAT_CONFIG };
