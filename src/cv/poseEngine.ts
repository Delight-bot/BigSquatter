/**
 * Thin wrapper around MediaPipe's Pose Landmarker.
 *
 * Everything here is on-device: the WASM runtime and the model are served from
 * the app's own origin (see `scripts/copy-mediapipe.mjs` and
 * `scripts/fetch-model.mjs`), and no frame ever leaves the phone.
 *
 * Two details this wrapper exists to handle:
 *  - `detectForVideo` rejects non-increasing timestamps, and requestAnimationFrame
 *    can hand us the same millisecond twice, so timestamps are forced upward.
 *  - The GPU delegate is unavailable on some mobile browsers; we fall back to
 *    CPU instead of failing the whole session.
 */

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Landmark } from './landmarks';

const REMOTE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export interface PoseEngineOptions {
  /** Defaults to the model vendored under `public/models`, then the Google CDN. */
  modelUrl?: string;
  /** Directory holding `vision_wasm_internal.*`. */
  wasmBase?: string;
  minPoseDetectionConfidence?: number;
  minPosePresenceConfidence?: number;
  minTrackingConfidence?: number;
}

export type PoseDelegate = 'GPU' | 'CPU';

export interface PoseResult {
  /** Normalised (0..1) landmarks for the primary person, or null if none found. */
  landmarks: Landmark[] | null;
}

const LOCAL_MODEL_URL = `${import.meta.env.BASE_URL}models/pose_landmarker_lite.task`;
const LOCAL_WASM_BASE = `${import.meta.env.BASE_URL}mediapipe/wasm`;

async function resolveModelUrl(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const fromEnv = import.meta.env.VITE_POSE_MODEL_URL;
  if (fromEnv) return fromEnv;
  try {
    // A HEAD request is enough to know whether the model was vendored locally.
    const res = await fetch(LOCAL_MODEL_URL, { method: 'HEAD' });
    if (res.ok) return LOCAL_MODEL_URL;
  } catch {
    // Offline or blocked — fall through to the CDN and let it fail loudly.
  }
  return REMOTE_MODEL_URL;
}

export class PoseEngine {
  private lastTimestamp = -1;
  private readonly landmarker: PoseLandmarker;
  readonly delegate: PoseDelegate;

  private constructor(landmarker: PoseLandmarker, delegate: PoseDelegate) {
    this.landmarker = landmarker;
    this.delegate = delegate;
  }

  static async create(options: PoseEngineOptions = {}): Promise<PoseEngine> {
    const wasmBase = options.wasmBase ?? LOCAL_WASM_BASE;
    const fileset = await FilesetResolver.forVisionTasks(wasmBase);
    const modelAssetPath = await resolveModelUrl(options.modelUrl);

    const build = (delegate: PoseDelegate) =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: options.minPoseDetectionConfidence ?? 0.5,
        minPosePresenceConfidence: options.minPosePresenceConfidence ?? 0.5,
        minTrackingConfidence: options.minTrackingConfidence ?? 0.5,
      });

    try {
      return new PoseEngine(await build('GPU'), 'GPU');
    } catch {
      return new PoseEngine(await build('CPU'), 'CPU');
    }
  }

  /**
   * Runs detection on the current video frame. Synchronous by design — it is
   * called from inside a requestAnimationFrame loop.
   */
  detect(video: HTMLVideoElement, timestampMs: number): PoseResult {
    // Strictly increasing, or MediaPipe throws.
    const ts = timestampMs <= this.lastTimestamp ? this.lastTimestamp + 1 : timestampMs;
    this.lastTimestamp = ts;

    const result = this.landmarker.detectForVideo(video, ts);
    const landmarks = result.landmarks?.[0];
    return { landmarks: landmarks && landmarks.length > 0 ? (landmarks as Landmark[]) : null };
  }

  close(): void {
    this.landmarker.close();
  }
}

/** Requests the rear camera at a size that keeps inference cheap on phones. */
export async function openCamera(
  facingMode: 'user' | 'environment' = 'user',
): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser does not expose a camera API.');
  }
  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode,
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 30, max: 30 },
    },
    audio: false,
  });
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}
