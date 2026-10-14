import { describe, expect, it } from 'vitest';
import { DEFAULT_SQUAT_CONFIG, SquatDetector, type SquatUpdate } from './squatDetector';

const FRAME_MS = 33; // ~30fps, matching the real capture rate.

/** Feeds a sequence of knee angles at a fixed frame rate. */
function feed(
  detector: SquatDetector,
  angles: number[],
  startMs = 1000,
  frameMs = FRAME_MS,
): SquatUpdate[] {
  return angles.map((angle, i) => detector.update(angle, startMs + i * frameMs));
}

function ramp(from: number, to: number, steps: number): number[] {
  return Array.from({ length: steps }, (_, i) => from + ((to - from) * (i + 1)) / steps);
}

/**
 * A synthetic squat: stand, descend to `depth`, pause, rise, stand.
 * `frames` controls how long each leg takes and therefore the rep duration.
 */
function squatCycle(depth = 85, frames = 12): number[] {
  return [
    ...Array(4).fill(172),
    ...ramp(172, depth, frames),
    ...Array(3).fill(depth),
    ...ramp(depth, 172, frames),
    ...Array(4).fill(172),
  ];
}

/** Raw angles only; smoothing is exercised separately. */
const raw = () => new SquatDetector({ smoothingAlpha: 1 });

describe('SquatDetector', () => {
  it('counts one rep for one full squat', () => {
    const d = raw();
    feed(d, squatCycle());
    expect(d.reps).toBe(1);
  });

  it('counts each rep exactly once across many frames', () => {
    const d = raw();
    const angles = [...squatCycle(), ...squatCycle(), ...squatCycle()];
    expect(angles.length).toBeGreaterThan(90); // ~90 frames, 3 reps
    feed(d, angles);
    expect(d.reps).toBe(3);
  });

  it('emits the completed rep on exactly one frame', () => {
    const d = raw();
    const updates = feed(d, squatCycle());
    const completions = updates.filter((u) => u.completedRep !== null);
    expect(completions).toHaveLength(1);
    expect(completions[0].completedRep?.index).toBe(1);
  });

  it('does not count a squat that never reaches depth', () => {
    const d = raw();
    // Bottoms out at 120°, well above the 100° depth threshold.
    feed(d, squatCycle(120));
    expect(d.reps).toBe(0);
  });

  it('hints "shallow" for a near-miss rather than staying silent', () => {
    const d = raw();
    const updates = feed(d, squatCycle(115));
    expect(updates.some((u) => u.hint === 'shallow')).toBe(true);
    expect(d.reps).toBe(0);
  });

  it('does not count a descent that is never completed', () => {
    const d = raw();
    // Goes deep and stays there — no rep until the user stands back up.
    feed(d, [...Array(4).fill(172), ...ramp(172, 80, 10), ...Array(10).fill(80)]);
    expect(d.reps).toBe(0);
    expect(d.currentPhase).toBe('bottom');
  });

  it('does not ratchet when the user hovers around the depth threshold', () => {
    const d = raw();
    const hover = Array.from({ length: 40 }, (_, i) =>
      DEFAULT_SQUAT_CONFIG.depthAngle + (i % 2 === 0 ? -1 : 3),
    );
    feed(d, [...Array(4).fill(172), ...ramp(172, 95, 8), ...hover]);
    expect(d.reps).toBe(0);
  });

  it('ignores a rep faster than minRepMs', () => {
    const d = raw();
    // Same shape, but each leg is a single frame: ~100ms end to end.
    const updates = feed(d, [172, 172, 90, 90, 172, 172]);
    expect(d.reps).toBe(0);
    expect(updates.some((u) => u.hint === 'too-fast')).toBe(true);
  });

  it('counts a slow, deliberate rep', () => {
    const d = raw();
    feed(d, squatCycle(80, 45)); // ~3.2s
    expect(d.reps).toBe(1);
  });

  it('abandons a rep held longer than maxRepMs', () => {
    const d = new SquatDetector({ smoothingAlpha: 1, maxRepMs: 2000 });
    const stuck = [...Array(4).fill(172), ...ramp(172, 85, 6), ...Array(120).fill(85)];
    const updates = feed(d, stuck);
    expect(updates.some((u) => u.hint === 'abandoned')).toBe(true);
    // Standing back up after the timeout must not resurrect the abandoned rep.
    feed(d, ramp(85, 172, 8), 1000 + stuck.length * FRAME_MS);
    expect(d.reps).toBe(0);
  });

  it('requires an upright baseline before counting', () => {
    const d = raw();
    // Starts already crouched: standing up is not a rep.
    feed(d, [...Array(6).fill(85), ...ramp(85, 172, 10)]);
    expect(d.reps).toBe(0);
    // But the next full squat counts, because the baseline is now established.
    feed(d, squatCycle(), 5000);
    expect(d.reps).toBe(1);
  });

  it('counts a second dip at the bottom as one rep, not two', () => {
    const d = raw();
    feed(d, [
      ...Array(4).fill(172),
      ...ramp(172, 85, 10),
      ...ramp(85, 112, 4), // partial rise
      ...ramp(112, 85, 4), // dips again
      ...ramp(85, 172, 10),
      ...Array(3).fill(172),
    ]);
    expect(d.reps).toBe(1);
  });

  it('survives dropped frames mid-rep', () => {
    const d = raw();
    const cycle = squatCycle();
    // Blank out three frames during the descent — NaN means "no usable pose".
    const withGaps = cycle.map((a, i) => (i >= 8 && i < 11 ? Number.NaN : a));
    feed(d, withGaps);
    expect(d.reps).toBe(1);
  });

  it('abandons the rep when tracking is lost for longer than the grace period', () => {
    const d = new SquatDetector({ smoothingAlpha: 1, trackingGraceMs: 500 });
    feed(d, [...Array(4).fill(172), ...ramp(172, 85, 8)]);
    const lostStart = 1000 + 12 * FRAME_MS;
    const updates = feed(d, Array(30).fill(Number.NaN), lostStart);
    expect(updates.some((u) => u.hint === 'abandoned')).toBe(true);
    expect(d.currentPhase).toBe('unknown');
  });

  it('still counts reps with smoothing enabled', () => {
    const d = new SquatDetector(); // default alpha 0.5
    feed(d, [...squatCycle(80, 16), ...squatCycle(80, 16)]);
    expect(d.reps).toBe(2);
  });

  it('rejects noise that smoothing should absorb', () => {
    const d = new SquatDetector({ smoothingAlpha: 0.35 });
    // Single-frame spikes down to 70°, as seen when a landmark jumps.
    const noisy = Array.from({ length: 60 }, (_, i) => (i % 7 === 0 ? 70 : 172));
    feed(d, noisy);
    expect(d.reps).toBe(0);
  });

  it('reports depth as 0 standing and 1 at the target', () => {
    const d = raw();
    expect(d.update(DEFAULT_SQUAT_CONFIG.standingAngle, 0).depth).toBe(0);
    expect(d.update(DEFAULT_SQUAT_CONFIG.depthAngle, 33).depth).toBe(1);
    // Deeper than the target stays clamped at 1.
    expect(d.update(60, 66).depth).toBe(1);
  });

  it('records duration and depth on the completed rep', () => {
    const d = raw();
    const updates = feed(d, squatCycle(80, 15));
    const rep = updates.find((u) => u.completedRep)?.completedRep;
    expect(rep).toBeDefined();
    expect(rep!.minAngle).toBeCloseTo(80, 5);
    expect(rep!.depth).toBe(1);
    expect(rep!.durationMs).toBeGreaterThan(DEFAULT_SQUAT_CONFIG.minRepMs);
    expect(rep!.endedAt - rep!.startedAt).toBeCloseTo(rep!.durationMs, 5);
  });

  it('reset() clears the count and the baseline', () => {
    const d = raw();
    feed(d, squatCycle());
    expect(d.reps).toBe(1);
    d.reset();
    expect(d.reps).toBe(0);
    expect(d.currentPhase).toBe('unknown');
  });

  it('rejects an incoherent threshold configuration', () => {
    expect(() => new SquatDetector({ depthAngle: 165 })).toThrow(/standingAngle/);
    expect(() => new SquatDetector({ releaseMargin: 90 })).toThrow(/releaseMargin/);
  });
});
