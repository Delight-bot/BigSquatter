/**
 * Framing and form guidance.
 *
 * Two separate jobs live here:
 *
 *  - `evaluateFraming` answers "can we trust this pose at all?" — it gates the
 *    rep counter, because a half-visible body produces angles that look like
 *    squats. This runs before counting starts and keeps running during a set.
 *  - `hintMessage` turns a detector hint into one short line of coaching.
 *
 * V1 deliberately stops there: no composite "form score", which would need
 * calibration data we don't have.
 */

import { REQUIRED_LANDMARKS, POSE, visibilityOf, type Landmark } from './landmarks';
import type { SquatHint } from './squatDetector';

export type FramingProblem =
  | 'no-pose'
  | 'landmarks-hidden'
  | 'too-close'
  | 'too-far'
  | 'off-centre';

export interface FramingResult {
  /** True when the pose is good enough to count reps from. */
  ready: boolean;
  problem: FramingProblem | null;
  message: string;
  /** Fraction of the frame height the body occupies, 0 when unknown. */
  bodyHeight: number;
}

export interface FramingConfig {
  minVisibility: number;
  /** Body must fill at least this fraction of frame height. */
  minBodyHeight: number;
  /** Above this the user is cropped or about to be. */
  maxBodyHeight: number;
  /** How far outside the frame a required landmark may sit before we complain. */
  edgeTolerance: number;
}

export const DEFAULT_FRAMING_CONFIG: FramingConfig = {
  minVisibility: 0.5,
  minBodyHeight: 0.45,
  maxBodyHeight: 0.98,
  edgeTolerance: 0.02,
};

const READY: FramingResult = {
  ready: true,
  problem: null,
  message: 'Looking good — start squatting.',
  bodyHeight: 0,
};

export function evaluateFraming(
  landmarks: readonly Landmark[] | null | undefined,
  config: Partial<FramingConfig> = {},
): FramingResult {
  const cfg = { ...DEFAULT_FRAMING_CONFIG, ...config };

  if (!landmarks || landmarks.length < 33) {
    return {
      ready: false,
      problem: 'no-pose',
      message: 'Step into view so the camera can see you.',
      bodyHeight: 0,
    };
  }

  const hidden = REQUIRED_LANDMARKS.some(
    (i) => visibilityOf(landmarks[i]) < cfg.minVisibility,
  );
  if (hidden) {
    return {
      ready: false,
      problem: 'landmarks-hidden',
      message: 'Keep your whole body in frame.',
      bodyHeight: 0,
    };
  }

  // Shoulders down to ankles is a stable proxy for apparent body size: unlike
  // the nose or the eyes it stays visible when the user looks down mid-squat.
  const shoulderY = Math.min(
    landmarks[POSE.leftShoulder].y,
    landmarks[POSE.rightShoulder].y,
  );
  const ankleY = Math.max(landmarks[POSE.leftAnkle].y, landmarks[POSE.rightAnkle].y);
  const bodyHeight = ankleY - shoulderY;

  const outOfFrame = REQUIRED_LANDMARKS.some((i) => {
    const lm = landmarks[i];
    return (
      lm.x < -cfg.edgeTolerance ||
      lm.x > 1 + cfg.edgeTolerance ||
      lm.y < -cfg.edgeTolerance ||
      lm.y > 1 + cfg.edgeTolerance
    );
  });
  if (outOfFrame || bodyHeight > cfg.maxBodyHeight) {
    return {
      ready: false,
      problem: 'too-close',
      message: 'Move farther from the camera.',
      bodyHeight,
    };
  }

  if (bodyHeight < cfg.minBodyHeight) {
    return {
      ready: false,
      problem: 'too-far',
      message: 'Move a little closer to the camera.',
      bodyHeight,
    };
  }

  const hipCentreX = (landmarks[POSE.leftHip].x + landmarks[POSE.rightHip].x) / 2;
  if (hipCentreX < 0.15 || hipCentreX > 0.85) {
    return {
      ready: false,
      problem: 'off-centre',
      message: 'Step into the middle of the frame.',
      bodyHeight,
    };
  }

  return { ...READY, bodyHeight };
}

export function hintMessage(hint: SquatHint): string | null {
  switch (hint) {
    case 'shallow':
      return 'Go a little lower.';
    case 'too-fast':
      return 'Slow it down — that one was too quick to count.';
    case 'abandoned':
      return 'Stand up tall to reset.';
    case 'good':
      return 'Good depth.';
    default:
      return null;
  }
}

/** Average depth across a set, as a percentage, for the session summary. */
export function averageDepthPercent(depths: readonly number[]): number {
  if (depths.length === 0) return 0;
  const sum = depths.reduce((acc, d) => acc + d, 0);
  return Math.round((sum / depths.length) * 100);
}
