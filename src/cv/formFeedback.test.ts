import { describe, expect, it } from 'vitest';
import { averageDepthPercent, evaluateFraming, hintMessage } from './formFeedback';
import { POSE, type Landmark } from './landmarks';

/**
 * A well-framed standing figure: centred, filling ~60% of the frame height.
 * Individual landmarks are overridden per test to create each failure mode.
 */
function framedPose(overrides: Partial<Record<number, Landmark>> = {}): Landmark[] {
  const lm = (x: number, y: number): Landmark => ({ x, y, visibility: 0.95 });
  const base: Landmark[] = Array.from({ length: 33 }, () => lm(0.5, 0.5));
  base[POSE.leftShoulder] = lm(0.44, 0.22);
  base[POSE.rightShoulder] = lm(0.56, 0.22);
  base[POSE.leftHip] = lm(0.45, 0.5);
  base[POSE.rightHip] = lm(0.55, 0.5);
  base[POSE.leftKnee] = lm(0.45, 0.66);
  base[POSE.rightKnee] = lm(0.55, 0.66);
  base[POSE.leftAnkle] = lm(0.45, 0.85);
  base[POSE.rightAnkle] = lm(0.55, 0.85);
  for (const [index, value] of Object.entries(overrides)) {
    if (value) base[Number(index)] = value;
  }
  return base;
}

describe('evaluateFraming', () => {
  it('accepts a well-framed body', () => {
    const result = evaluateFraming(framedPose());
    expect(result.ready).toBe(true);
    expect(result.problem).toBeNull();
    expect(result.bodyHeight).toBeCloseTo(0.63, 2);
  });

  it('asks the user to step into view when there is no pose', () => {
    expect(evaluateFraming(null).problem).toBe('no-pose');
    expect(evaluateFraming([]).problem).toBe('no-pose');
    expect(evaluateFraming(undefined).ready).toBe(false);
  });

  it('flags a hidden required landmark', () => {
    const result = evaluateFraming(
      framedPose({ [POSE.leftAnkle]: { x: 0.45, y: 0.85, visibility: 0.2 } }),
    );
    expect(result.problem).toBe('landmarks-hidden');
    expect(result.message).toMatch(/whole body/i);
  });

  it('flags a body that is too small in frame', () => {
    const small = framedPose({
      [POSE.leftShoulder]: { x: 0.48, y: 0.42, visibility: 0.95 },
      [POSE.rightShoulder]: { x: 0.52, y: 0.42, visibility: 0.95 },
      [POSE.leftAnkle]: { x: 0.48, y: 0.68, visibility: 0.95 },
      [POSE.rightAnkle]: { x: 0.52, y: 0.68, visibility: 0.95 },
    });
    const result = evaluateFraming(small);
    expect(result.problem).toBe('too-far');
    expect(result.message).toMatch(/closer/i);
  });

  it('flags a body cropped by the edge of the frame', () => {
    const result = evaluateFraming(
      framedPose({ [POSE.leftAnkle]: { x: 0.45, y: 1.09, visibility: 0.95 } }),
    );
    expect(result.problem).toBe('too-close');
    expect(result.message).toMatch(/farther/i);
  });

  it('flags a body pushed to the side of the frame', () => {
    const offset = framedPose({
      [POSE.leftHip]: { x: 0.02, y: 0.5, visibility: 0.95 },
      [POSE.rightHip]: { x: 0.1, y: 0.5, visibility: 0.95 },
    });
    expect(evaluateFraming(offset).problem).toBe('off-centre');
  });

  it('tolerates a landmark a hair outside the frame', () => {
    // MediaPipe extrapolates slightly past the edge; a 1% overshoot is not a
    // framing problem and must not interrupt a set.
    const result = evaluateFraming(
      framedPose({ [POSE.rightAnkle]: { x: 0.55, y: 1.01, visibility: 0.95 } }),
    );
    expect(result.ready).toBe(true);
  });

  it('respects a caller-supplied threshold', () => {
    const result = evaluateFraming(framedPose(), { minBodyHeight: 0.9 });
    expect(result.problem).toBe('too-far');
  });
});

describe('hintMessage', () => {
  it('turns each hint into a short coaching line', () => {
    expect(hintMessage('shallow')).toMatch(/lower/i);
    expect(hintMessage('too-fast')).toMatch(/slow/i);
    expect(hintMessage('abandoned')).toMatch(/stand up/i);
    expect(hintMessage('good')).toMatch(/good/i);
  });
});

describe('averageDepthPercent', () => {
  it('is zero for an empty set', () => {
    expect(averageDepthPercent([])).toBe(0);
  });

  it('averages and converts to a rounded percentage', () => {
    expect(averageDepthPercent([1, 1, 1])).toBe(100);
    expect(averageDepthPercent([0.5, 1])).toBe(75);
    expect(averageDepthPercent([0.333, 0.333, 0.333])).toBe(33);
  });
});
