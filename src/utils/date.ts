/**
 * Local-calendar date helpers.
 *
 * The whole app reasons about days in the user's own timezone, so every date is
 * stored as a `YYYY-MM-DD` string built from local getters (never `toISOString`,
 * which silently shifts the day for anyone west of UTC).
 */

export type DateKey = string; // YYYY-MM-DD

const pad = (n: number) => String(n).padStart(2, '0');

export function toDateKey(date: Date): DateKey {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Parses a `YYYY-MM-DD` key into a local Date at midnight. */
export function fromDateKey(key: DateKey): Date {
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date key: ${key}`);
  return new Date(y, m - 1, d);
}

export function todayKey(now: Date = new Date()): DateKey {
  return toDateKey(now);
}

export function addDays(key: DateKey, days: number): DateKey {
  const d = fromDateKey(key);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

/** Whole calendar days from `from` to `to`. Negative when `to` precedes `from`. */
export function daysBetween(from: DateKey, to: DateKey): number {
  const a = fromDateKey(from).getTime();
  const b = fromDateKey(to).getTime();
  // Round rather than floor: DST transitions make some spans 23 or 25 hours.
  return Math.round((b - a) / 86_400_000);
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${pad(s)}`;
}

export function monthLabel(key: DateKey): string {
  return fromDateKey(key).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** Monday-first weekday index (0 = Monday ... 6 = Sunday). */
export function mondayFirstWeekday(key: DateKey): number {
  return (fromDateKey(key).getDay() + 6) % 7;
}
