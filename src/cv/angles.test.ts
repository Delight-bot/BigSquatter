import { describe, expect, it } from 'vitest';
import { AngleSmoother, angleAtVertex, computeJointAngles, midpoint } from './angles';
import { POSE, type Landmark } from './landmarks';

describe('angleAtVertex', () => {
  it('measures a right angle', () => {
    expect(angleAtVertex({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(90);
  });

  it('measures a straight limb as 180 degrees', () => {
    expect(angleAtVertex({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 })).toBeCloseTo(180);
  });

  it('measures a fully folded limb as 0 degrees', () => {
    expect(angleAtVertex({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(0);
  });

  it('is symmetric in its outer points', () => {
    const a = { x: 0.2, y: 0.9 };
    const v = { x: 0.4, y: 0.6 };
    const c = { x: 0.55, y: 0.2 };
    expect(angleAtVertex(a, v, c)).toBeCloseTo(angleAtVertex(c, v, a));
  });

  it('never exceeds the [0, 180] range even for collinear input', () => {
    // Floating point can push the cosine past ±1; the clamp must hold.
    for (let i = 0; i < 100; i += 1) {
      const t = i / 99;
      const angle = angleAtVertex({ x: 0, y: 0 }, { x: t, y: t }, { x: 1, y: 1 });
      if (!Number.isNaN(angle)) {
        expect(angle).toBeGreaterThanOrEqual(0);
        expect(angle).toBeLessThanOrEqual(180);
      }
    }
  });

  it('returns NaN for a degenerate triangle', () => {
    expect(angleAtVertex({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 2 })).toBeNaN();
  });
});

describe('midpoint', () => {
  it('averages both axes', () => {
    expect(midpoint({ x: 0, y: 0 }, { x: 1, y: 3 })).toEqual({ x: 0.5, y: 1.5 });
  });
});

/** Builds a 33-landmark array, then applies the given overrides. */
function pose(overrides: Record<number, Landmark>): Landmark[] {
  const base: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  for (const [index, lm] of Object.entries(overrides)) base[Number(index)] = lm;
  return base;
}

/** A standing figure: hip, knee and ankle vertically stacked → straight legs. */
function standingPose(kneeOffsetX = 0): Landmark[] {
  const vis = 1;
  return pose({
    [POSE.leftShoulder]: { x: 0.45, y: 0.2, visibility: vis },
    [POSE.rightShoulder]: { x: 0.55, y: 0.2, visibility: vis },
    [POSE.leftHip]: { x: 0.46, y: 0.5, visibility: vis },
    [POSE.rightHip]: { x: 0.54, y: 0.5, visibility: vis },
    [POSE.leftKnee]: { x: 0.46 + kneeOffsetX, y: 0.7, visibility: vis },
    [POSE.rightKnee]: { x: 0.54 + kneeOffsetX, y: 0.7, visibility: vis },
    [POSE.leftAnkle]: { x: 0.46, y: 0.9, visibility: vis },
    [POSE.rightAnkle]: { x: 0.54, y: 0.9, visibility: vis },
  });
}

describe('computeJointAngles', () => {
  it('reads near-180° knees when standing', () => {
    const angles = computeJointAngles(standingPose());
    expect(angles.leftKnee).toBeCloseTo(180);
    expect(angles.rightKnee).toBeCloseTo(180);
    expect(angles.knee).toBeCloseTo(180);
  });

  it('reads a flexed knee when the knee juts forward', () => {
    const angles = computeJointAngles(standingPose(0.18));
    expect(angles.knee).toBeLessThan(120);
  });

  it('takes the more-flexed knee, so an occlusion-straightened leg cannot mask depth', () => {
    const landmarks = standingPose();
    // Left knee driven forward (deep), right leg left straight.
    landmarks[POSE.leftKnee] = { x: 0.7, y: 0.7, visibility: 1 };
    const angles = computeJointAngles(landmarks);
    expect(angles.leftKnee).toBeLessThan(angles.rightKnee);
    expect(angles.knee).toBeCloseTo(angles.leftKnee);
  });

  it('ignores landmarks below the visibility threshold', () => {
    const landmarks = standingPose();
    landmarks[POSE.leftAnkle] = { x: 0.46, y: 0.9, visibility: 0.1 };
    const angles = computeJointAngles(landmarks);
    expect(angles.leftKnee).toBeNaN();
    // The visible right leg still yields a usable signal.
    expect(angles.knee).toBeCloseTo(angles.rightKnee);
  });

  it('returns NaN when no leg is measurable', () => {
    const landmarks = standingPose().map((lm) => ({ ...lm, visibility: 0.1 }));
    expect(computeJointAngles(landmarks).knee).toBeNaN();
  });

  it('returns NaN for a truncated landmark array', () => {
    expect(computeJointAngles([]).knee).toBeNaN();
    expect(computeJointAngles(standingPose().slice(0, 20)).knee).toBeNaN();
  });

  it('treats a missing visibility field as fully visible', () => {
    const landmarks = standingPose().map(({ x, y }) => ({ x, y }));
    expect(computeJointAngles(landmarks).knee).toBeCloseTo(180);
  });
});

describe('AngleSmoother', () => {
  it('returns the first sample unchanged', () => {
    expect(new AngleSmoother(0.5).push(120)).toBe(120);
  });

  it('converges toward a step input without overshooting', () => {
    const s = new AngleSmoother(0.5);
    s.push(180);
    const values = Array.from({ length: 14 }, () => s.push(90));
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeLessThan(values[i - 1]);
      expect(values[i]).toBeGreaterThan(90);
    }
    // 14 halvings of a 90° step leaves well under a tenth of a degree.
    expect(values.at(-1)).toBeCloseTo(90, 1);
  });

  it('passes values straight through at alpha 1', () => {
    const s = new AngleSmoother(1);
    expect(s.push(170)).toBe(170);
    expect(s.push(80)).toBe(80);
  });

  it('holds its value through NaN samples rather than being poisoned', () => {
    const s = new AngleSmoother(0.5);
    s.push(150);
    expect(s.push(Number.NaN)).toBe(150);
    expect(s.current).toBe(150);
    expect(s.push(150)).toBe(150);
  });

  it('starts fresh after reset', () => {
    const s = new AngleSmoother(0.5);
    s.push(180);
    s.reset();
    expect(s.current).toBeNaN();
    expect(s.push(90)).toBe(90);
  });

  it('rejects an out-of-range alpha', () => {
    expect(() => new AngleSmoother(0)).toThrow();
    expect(() => new AngleSmoother(1.5)).toThrow();
  });
});
