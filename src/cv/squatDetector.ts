/**
 * Squat rep counter: a hysteretic state machine over a single knee-flexion
 * signal.
 *
 * Why a state machine rather than thresholding each frame: at 30fps a single
 * squat spans ~40 frames, so any per-frame rule counts one squat dozens of
 * times. Requiring the signal to travel standing -> depth -> standing means a
 * rep is only emitted once the full movement has been observed, and the
 * `releaseMargin` hysteresis stops a user hovering exactly at the depth
 * threshold from ratcheting the counter.
 *
 * The detector is deliberately free of any camera, React or DOM dependency: it
 * takes numbers and a clock reading, which makes the counting rules directly
 * unit-testable without a webcam.
 */

import { AngleSmoother } from './angles';

export type SquatPhase = 'unknown' | 'standing' | 'descending' | 'bottom' | 'ascending';

export interface SquatDetectorConfig {
  /** Knee angle (deg) at or above which the user is considered upright. */
  standingAngle: number;
  /**
   * Dropping below this starts a candidate rep. Kept below `standingAngle` so
   * that jitter while standing still doesn't arm the machine.
   */
  descentAngle: number;
  /** Knee angle at or below which depth is judged sufficient (~parallel thighs). */
  depthAngle: number;
  /** Degrees the user must rise past `depthAngle` before we believe they are ascending. */
  releaseMargin: number;
  /** Reps quicker than this are treated as tracking noise, not squats. */
  minRepMs: number;
  /** A candidate rep held longer than this is abandoned (user walked off, sat down, paused). */
  maxRepMs: number;
  /** Frames can drop; after this long with no usable pose an in-flight rep is abandoned. */
  trackingGraceMs: number;
  /** EMA factor applied to the incoming angle. 1 disables smoothing. */
  smoothingAlpha: number;
  /** A rep that reached within this many degrees of depth earns a "go lower" hint. */
  nearMissMargin: number;
}

export const DEFAULT_SQUAT_CONFIG: SquatDetectorConfig = {
  standingAngle: 160,
  descentAngle: 150,
  depthAngle: 100,
  releaseMargin: 8,
  minRepMs: 400,
  maxRepMs: 10_000,
  trackingGraceMs: 1_500,
  smoothingAlpha: 0.5,
  nearMissMargin: 25,
};

export interface RepRecord {
  /** 1-based rep number within the session. */
  index: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  /** Deepest (smallest) knee angle reached, in degrees. */
  minAngle: number;
  /** 0..1, how far the rep travelled toward the depth target. */
  depth: number;
}

export type SquatHint =
  | 'shallow' // came down, but not deep enough to count
  | 'too-fast' // full range of motion but implausibly quick
  | 'abandoned' // held at the bottom too long, or tracking lost mid-rep
  | 'good';

export interface SquatUpdate {
  phase: SquatPhase;
  /** Smoothed knee angle, NaN while the pose is unusable. */
  angle: number;
  reps: number;
  /** Non-null on exactly the frame a rep is counted. */
  completedRep: RepRecord | null;
  /** Non-null on frames where the machine has something to say. */
  hint: SquatHint | null;
  /** 0..1 progress from standing to the depth target, for the live depth gauge. */
  depth: number;
}

export class SquatDetector {
  private readonly config: SquatDetectorConfig;
  private smoother: AngleSmoother;

  private phase: SquatPhase = 'unknown';
  private repCount = 0;
  private repStartedAt = 0;
  private repMinAngle = Number.POSITIVE_INFINITY;
  private lastTrackedAt = 0;

  constructor(config: Partial<SquatDetectorConfig> = {}) {
    this.config = { ...DEFAULT_SQUAT_CONFIG, ...config };
    const { standingAngle, descentAngle, depthAngle, releaseMargin } = this.config;
    if (!(depthAngle < descentAngle && descentAngle <= standingAngle)) {
      throw new Error('Expected depthAngle < descentAngle <= standingAngle');
    }
    if (depthAngle + releaseMargin >= standingAngle) {
      throw new Error('releaseMargin is too large for the configured angle band');
    }
    this.smoother = new AngleSmoother(this.config.smoothingAlpha);
  }

  get reps(): number {
    return this.repCount;
  }

  get currentPhase(): SquatPhase {
    return this.phase;
  }

  reset(): void {
    this.smoother = new AngleSmoother(this.config.smoothingAlpha);
    this.phase = 'unknown';
    this.repCount = 0;
    this.clearRep();
    this.lastTrackedAt = 0;
  }

  /**
   * Feeds one frame to the machine.
   *
   * @param rawKneeAngle knee flexion in degrees, or NaN when the pose is unusable.
   * @param now timestamp in ms (`performance.now()` in the app).
   */
  update(rawKneeAngle: number, now: number): SquatUpdate {
    const { config } = this;

    if (Number.isNaN(rawKneeAngle)) {
      // Tracking lost. Hold the phase briefly — a dropped frame or two during a
      // rep is normal — then abandon the candidate so the next real rep starts
      // from a clean standing baseline.
      if (this.inRep() && now - this.lastTrackedAt > config.trackingGraceMs) {
        this.abandonRep();
        return this.result(Number.NaN, null, 'abandoned');
      }
      return this.result(this.smoother.current, null, null);
    }

    this.lastTrackedAt = now;
    const angle = this.smoother.push(rawKneeAngle);

    if (this.inRep()) {
      this.repMinAngle = Math.min(this.repMinAngle, angle);
      if (now - this.repStartedAt > config.maxRepMs) {
        this.clearRep();
        this.phase = angle >= config.standingAngle ? 'standing' : 'unknown';
        return this.result(angle, null, 'abandoned');
      }
    }

    switch (this.phase) {
      case 'unknown':
        // Wait for a clean upright baseline before arming; otherwise a user who
        // opens the camera already crouched earns a phantom rep on standing up.
        if (angle >= config.standingAngle) this.phase = 'standing';
        return this.result(angle, null, null);

      case 'standing':
        if (angle < config.descentAngle) {
          this.phase = 'descending';
          this.repStartedAt = now;
          this.repMinAngle = angle;
        }
        return this.result(angle, null, null);

      case 'descending':
        if (angle <= config.depthAngle) {
          this.phase = 'bottom';
          return this.result(angle, null, null);
        }
        if (angle >= config.standingAngle) {
          // Stood back up without ever reaching depth.
          const nearMiss = this.repMinAngle <= config.depthAngle + config.nearMissMargin;
          this.clearRep();
          this.phase = 'standing';
          return this.result(angle, null, nearMiss ? 'shallow' : null);
        }
        return this.result(angle, null, null);

      case 'bottom':
        if (angle >= config.depthAngle + config.releaseMargin) this.phase = 'ascending';
        return this.result(angle, null, null);

      case 'ascending':
        if (angle <= config.depthAngle) {
          // Dipped again before standing up: still the same rep.
          this.phase = 'bottom';
          return this.result(angle, null, null);
        }
        if (angle >= config.standingAngle) {
          const durationMs = now - this.repStartedAt;
          const minAngle = this.repMinAngle;
          this.clearRep();
          this.phase = 'standing';
          if (durationMs < config.minRepMs) return this.result(angle, null, 'too-fast');
          this.repCount += 1;
          const rep: RepRecord = {
            index: this.repCount,
            startedAt: now - durationMs,
            endedAt: now,
            durationMs,
            minAngle,
            depth: this.depthRatio(minAngle),
          };
          return this.result(angle, rep, 'good');
        }
        return this.result(angle, null, null);
    }
  }

  /** 0 at standing, 1 at the depth target, clamped to [0,1]. */
  private depthRatio(angle: number): number {
    const { standingAngle, depthAngle } = this.config;
    if (Number.isNaN(angle)) return 0;
    const ratio = (standingAngle - angle) / (standingAngle - depthAngle);
    return Math.min(1, Math.max(0, ratio));
  }

  private inRep(): boolean {
    return this.phase === 'descending' || this.phase === 'bottom' || this.phase === 'ascending';
  }

  private abandonRep(): void {
    this.clearRep();
    this.phase = 'unknown';
  }

  private clearRep(): void {
    this.repStartedAt = 0;
    this.repMinAngle = Number.POSITIVE_INFINITY;
  }

  private result(
    angle: number,
    completedRep: RepRecord | null,
    hint: SquatHint | null,
  ): SquatUpdate {
    return {
      phase: this.phase,
      angle,
      reps: this.repCount,
      completedRep,
      hint,
      depth: this.depthRatio(angle),
    };
  }
}
