/**
 * Hands-free signals, so nobody has to walk up to the phone mid-setup.
 *
 * "Hands up" (both wrists above the head) is used rather than a clap or an
 * open palm: it needs only the pose model already running (an open palm would
 * need a separate hand model), and it is unambiguous from across a room,
 * whereas a clap is a brief contact that the camera easily misses.
 */

import { POSE, visibilityOf, type Landmark } from './landmarks';

const MIN_VISIBILITY = 0.5;

/** Both wrists clearly visible and above the nose (image y grows downward). */
export function handsUp(landmarks: readonly Landmark[] | null | undefined): boolean {
  if (!landmarks) return false;
  const nose = landmarks[POSE.nose];
  const left = landmarks[POSE.leftWrist];
  const right = landmarks[POSE.rightWrist];
  if (!nose || !left || !right) return false;
  if (visibilityOf(left) < MIN_VISIBILITY || visibilityOf(right) < MIN_VISIBILITY) return false;
  return left.y < nose.y && right.y < nose.y;
}

/**
 * Fires once a condition has held continuously for `holdMs`, so a single
 * noisy frame — or someone briefly passing through a pose — can't trigger it.
 * After firing it stays quiet until the condition is released and held again.
 */
export class HoldTimer {
  private since: number | null = null;
  private fired = false;
  private readonly holdMs: number;

  constructor(holdMs: number) {
    this.holdMs = holdMs;
  }

  /** Returns true on exactly the frame the hold completes. */
  update(active: boolean, now: number): boolean {
    if (!active) {
      this.since = null;
      this.fired = false;
      return false;
    }
    this.since ??= now;
    if (this.fired || now - this.since < this.holdMs) return false;
    this.fired = true;
    return true;
  }

  /** 0..1 through the current hold; 0 when not active. */
  progress(now: number): number {
    if (this.since === null) return 0;
    return Math.min(1, (now - this.since) / this.holdMs);
  }

  reset(): void {
    this.since = null;
    this.fired = false;
  }
}
