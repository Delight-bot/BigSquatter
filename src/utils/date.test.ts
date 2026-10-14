import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  formatDuration,
  fromDateKey,
  mondayFirstWeekday,
  toDateKey,
  todayKey,
} from './date';

describe('toDateKey', () => {
  it('formats a local date with zero padding', () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toDateKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('uses the local calendar day, not the UTC one', () => {
    // 23:30 local on the 5th is the 6th in UTC anywhere east of UTC; the key
    // must still say the 5th, or the whole day/streak model shifts.
    const lateEvening = new Date(2026, 0, 5, 23, 30);
    expect(toDateKey(lateEvening)).toBe('2026-01-05');
    const earlyMorning = new Date(2026, 0, 5, 0, 30);
    expect(toDateKey(earlyMorning)).toBe('2026-01-05');
  });

  it('round-trips through fromDateKey', () => {
    expect(toDateKey(fromDateKey('2026-07-14'))).toBe('2026-07-14');
  });

  it('rejects a malformed key', () => {
    expect(() => fromDateKey('not-a-date')).toThrow();
    expect(() => fromDateKey('')).toThrow();
  });
});

describe('addDays', () => {
  it('moves forward within a month', () => {
    expect(addDays('2026-01-01', 5)).toBe('2026-01-06');
  });

  it('rolls over month and year boundaries', () => {
    expect(addDays('2026-01-30', 5)).toBe('2026-02-04');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-28', 2)).toBe('2028-03-01');
  });

  it('moves backward for a negative offset', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('covers a whole 30-day challenge', () => {
    expect(addDays('2026-01-01', 29)).toBe('2026-01-30');
  });
});

describe('daysBetween', () => {
  it('is zero for the same day', () => {
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
  });

  it('counts whole days forward', () => {
    expect(daysBetween('2026-01-01', '2026-01-12')).toBe(11);
  });

  it('is negative when the target precedes the origin', () => {
    expect(daysBetween('2026-01-12', '2026-01-01')).toBe(-11);
  });

  it('is exact across a DST transition', () => {
    // Late March and late October contain 23- and 25-hour days in many zones;
    // rounding (not flooring) is what keeps this at 7.
    expect(daysBetween('2026-03-25', '2026-04-01')).toBe(7);
    expect(daysBetween('2026-10-20', '2026-10-27')).toBe(7);
  });

  it('inverts addDays', () => {
    for (const offset of [1, 7, 29, 100]) {
      expect(daysBetween('2026-01-01', addDays('2026-01-01', offset))).toBe(offset);
    }
  });
});

describe('mondayFirstWeekday', () => {
  it('maps Monday to 0 and Sunday to 6', () => {
    expect(mondayFirstWeekday('2026-01-05')).toBe(0); // a Monday
    expect(mondayFirstWeekday('2026-01-11')).toBe(6); // the following Sunday
  });
});

describe('formatDuration', () => {
  it('formats minutes and seconds', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(9_000)).toBe('0:09');
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(3_600_000)).toBe('60:00');
  });

  it('clamps negative input to zero', () => {
    expect(formatDuration(-500)).toBe('0:00');
  });
});

describe('todayKey', () => {
  it('formats the supplied clock reading', () => {
    expect(todayKey(new Date(2026, 4, 9, 14, 0))).toBe('2026-05-09');
  });
});
