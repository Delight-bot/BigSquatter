import { describe, expect, it } from 'vitest';
import { msUntil, reminderCopy } from './notifications';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe('msUntil', () => {
  it('counts forward to a time later today', () => {
    expect(msUntil('18:00', new Date(2026, 0, 5, 17, 30))).toBe(30 * MINUTE);
  });

  it('rolls over to tomorrow once the time has passed', () => {
    expect(msUntil('08:00', new Date(2026, 0, 5, 9, 0))).toBe(23 * HOUR);
  });

  it('rolls over rather than firing instantly at the exact minute', () => {
    expect(msUntil('08:00', new Date(2026, 0, 5, 8, 0, 0))).toBe(24 * HOUR);
  });

  it('ignores seconds already elapsed in the current minute', () => {
    expect(msUntil('18:00', new Date(2026, 0, 5, 17, 59, 30))).toBe(30_000);
  });

  it('handles midnight', () => {
    expect(msUntil('00:00', new Date(2026, 0, 5, 23, 0))).toBe(HOUR);
  });

  it('rejects a malformed time', () => {
    expect(() => msUntil('later')).toThrow();
    expect(() => msUntil('')).toThrow();
  });
});

describe('reminderCopy', () => {
  it('leads with the streak when there is one to protect', () => {
    const copy = reminderCopy({ day: 15, target: 60, remaining: 60, streak: 11 });
    expect(copy.title).toContain('11');
    expect(copy.body).toContain('Day 15');
    expect(copy.body).toContain('60');
  });

  it('falls back to the day number with no streak yet', () => {
    const copy = reminderCopy({ day: 2, target: 25, remaining: 25, streak: 0 });
    expect(copy.title).toContain('Day 2');
  });

  it('reports the remaining reps, not the whole target', () => {
    const copy = reminderCopy({ day: 9, target: 50, remaining: 12, streak: 3 });
    expect(copy.body).toContain('12 of 50');
  });
});
