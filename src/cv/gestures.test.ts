import { describe, expect, it } from 'vitest';
import { handsUp, HoldTimer } from './gestures';
import { POSE, type Landmark } from './landmarks';

/** A standing pose with the wrists placed at the given heights (0 = top of frame). */
function pose(leftWristY: number, rightWristY: number, wristVisibility = 0.9): Landmark[] {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  landmarks[POSE.nose] = { x: 0.5, y: 0.2, visibility: 0.9 };
  landmarks[POSE.leftWrist] = { x: 0.4, y: leftWristY, visibility: wristVisibility };
  landmarks[POSE.rightWrist] = { x: 0.6, y: rightWristY, visibility: wristVisibility };
  return landmarks;
}

describe('handsUp', () => {
  it('is true with both wrists above the head', () => {
    expect(handsUp(pose(0.1, 0.12))).toBe(true);
  });

  it('needs both hands, not one', () => {
    expect(handsUp(pose(0.1, 0.6))).toBe(false);
    expect(handsUp(pose(0.6, 0.1))).toBe(false);
  });

  it('is false with arms down', () => {
    expect(handsUp(pose(0.6, 0.6))).toBe(false);
  });

  it('ignores wrists the model is unsure about', () => {
    expect(handsUp(pose(0.1, 0.1, 0.2))).toBe(false);
  });

  it('is false with no pose', () => {
    expect(handsUp(null)).toBe(false);
  });
});

describe('HoldTimer', () => {
  it('fires once the condition has held long enough', () => {
    const timer = new HoldTimer(800);
    expect(timer.update(true, 0)).toBe(false);
    expect(timer.update(true, 500)).toBe(false);
    expect(timer.progress(400)).toBeCloseTo(0.5);
    expect(timer.update(true, 800)).toBe(true);
  });

  it('fires only once per hold', () => {
    const timer = new HoldTimer(100);
    timer.update(true, 0);
    expect(timer.update(true, 100)).toBe(true);
    expect(timer.update(true, 200)).toBe(false);
    expect(timer.update(true, 900)).toBe(false);
  });

  it('starts over when the condition drops, even for one frame', () => {
    const timer = new HoldTimer(800);
    timer.update(true, 0);
    timer.update(true, 700);
    timer.update(false, 733); // A single noisy frame.
    expect(timer.update(true, 766)).toBe(false);
    expect(timer.update(true, 1500)).toBe(false);
    expect(timer.update(true, 1566)).toBe(true);
  });

  it('can fire again after being released', () => {
    const timer = new HoldTimer(100);
    timer.update(true, 0);
    timer.update(true, 100);
    timer.update(false, 150);
    timer.update(true, 200);
    expect(timer.update(true, 300)).toBe(true);
  });
});
