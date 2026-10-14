/**
 * Pure 2D geometry over pose landmarks.
 *
 * Angles are computed in normalised image space. That is fine for squats: the
 * knee/hip flexion we care about happens in the camera plane when the user
 * stands side-on or front-on to the phone, and normalised coordinates make the
 * maths resolution-independent.
 */

import { POSE, visibilityOf, type Landmark } from './landmarks';

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Interior angle at `vertex`, in degrees, in [0, 180].
 * Returns NaN if either limb has zero length (degenerate triangle).
 */
export function angleAtVertex(a: Point2D, vertex: Point2D, c: Point2D): number {
  const v1x = a.x - vertex.x;
  const v1y = a.y - vertex.y;
  const v2x = c.x - vertex.x;
  const v2y = c.y - vertex.y;

  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 === 0 || m2 === 0) return Number.NaN;

  // Clamp guards against floating point pushing the cosine just past ±1.
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / (m1 * m2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

export function midpoint(a: Point2D, b: Point2D): Point2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export interface JointAngles {
  /** Knee flexion per leg, NaN when the leg is not measurable. */
  leftKnee: number;
  rightKnee: number;
  /** Hip flexion per leg (shoulder-hip-knee). */
  leftHip: number;
  rightHip: number;
  /**
   * The angle the rep detector runs on: the more-flexed (smaller) of the two
   * knees when both are visible, otherwise whichever one is.
   *
   * Taking the minimum rather than the mean matters when the user stands
   * side-on to the camera: the far leg is often occluded and its landmarks
   * drift toward a straight line, which would wash out real depth in a mean.
   */
  knee: number;
  /** Mean hip flexion, used only for form hints. */
  hip: number;
}

const unmeasurable: JointAngles = {
  leftKnee: Number.NaN,
  rightKnee: Number.NaN,
  leftHip: Number.NaN,
  rightHip: Number.NaN,
  knee: Number.NaN,
  hip: Number.NaN,
};

/**
 * @param minVisibility landmarks below this confidence are ignored, so a
 * half-occluded leg yields NaN instead of a confidently wrong angle.
 */
export function computeJointAngles(
  landmarks: readonly Landmark[],
  minVisibility = 0.5,
): JointAngles {
  if (landmarks.length < 33) return unmeasurable;

  const at = (i: number): Landmark | undefined => {
    const lm = landmarks[i];
    return lm && visibilityOf(lm) >= minVisibility ? lm : undefined;
  };

  const kneeAngle = (hip?: Landmark, knee?: Landmark, ankle?: Landmark) =>
    hip && knee && ankle ? angleAtVertex(hip, knee, ankle) : Number.NaN;
  const hipAngle = (shoulder?: Landmark, hip?: Landmark, knee?: Landmark) =>
    shoulder && hip && knee ? angleAtVertex(shoulder, hip, knee) : Number.NaN;

  const leftKnee = kneeAngle(at(POSE.leftHip), at(POSE.leftKnee), at(POSE.leftAnkle));
  const rightKnee = kneeAngle(at(POSE.rightHip), at(POSE.rightKnee), at(POSE.rightAnkle));
  const leftHip = hipAngle(at(POSE.leftShoulder), at(POSE.leftHip), at(POSE.leftKnee));
  const rightHip = hipAngle(at(POSE.rightShoulder), at(POSE.rightHip), at(POSE.rightKnee));

  return {
    leftKnee,
    rightKnee,
    leftHip,
    rightHip,
    knee: minDefined(leftKnee, rightKnee),
    hip: meanDefined(leftHip, rightHip),
  };
}

function minDefined(a: number, b: number): number {
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  return Math.min(a, b);
}

function meanDefined(a: number, b: number): number {
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  return (a + b) / 2;
}

/**
 * Exponential moving average, used to take the per-frame jitter out of pose
 * angles before they reach the state machine.
 *
 * NaN inputs are passed through untouched and do not poison the running value,
 * so a few dropped frames don't corrupt the signal once tracking resumes.
 */
export class AngleSmoother {
  private value: number = Number.NaN;
  private readonly alpha: number;

  constructor(alpha = 0.5) {
    if (alpha <= 0 || alpha > 1) throw new Error('alpha must be in (0, 1]');
    this.alpha = alpha;
  }

  push(next: number): number {
    if (Number.isNaN(next)) return this.value;
    this.value = Number.isNaN(this.value)
      ? next
      : this.alpha * next + (1 - this.alpha) * this.value;
    return this.value;
  }

  get current(): number {
    return this.value;
  }

  reset(): void {
    this.value = Number.NaN;
  }
}
