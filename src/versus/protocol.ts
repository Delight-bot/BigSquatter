/**
 * Wire format for a live versus match.
 *
 * Everything arriving here comes from another person's browser, so it is
 * untrusted: `parseMessage` rejects anything malformed rather than letting a
 * bad payload reach the match state. Rep counts are clamped to a plausible
 * range for the same reason — this is not anti-cheat (a modified client can
 * still send any number in range), only a guard against garbage.
 */

export const PROTOCOL_VERSION = 1;

/** Upper bound on reps in one sprint; no one squats 10 times a second. */
export const MAX_REPS = 500;
const MAX_NAME_LENGTH = 24;

export type Message =
  | { type: 'hello'; v: number; name: string }
  | { type: 'ready'; ready: boolean }
  /** Host → guest: the countdown begins on receipt. */
  | { type: 'start'; countdownMs: number; durationMs: number }
  | { type: 'reps'; reps: number }
  /** Sent once when the sender's clock runs out, carrying their final count. */
  | { type: 'final'; reps: number }
  | { type: 'rematch' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function repCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < 0 || value > MAX_REPS) return null;
  return value;
}

function duration(value: unknown, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0 || value > max) return null;
  return value;
}

export function cleanName(name: string): string {
  const trimmed = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
  return trimmed || 'Friend';
}

export function parseMessage(data: unknown): Message | null {
  if (!isRecord(data)) return null;
  switch (data.type) {
    case 'hello':
      if (typeof data.v !== 'number' || typeof data.name !== 'string') return null;
      return { type: 'hello', v: data.v, name: cleanName(data.name) };
    case 'ready':
      if (typeof data.ready !== 'boolean') return null;
      return { type: 'ready', ready: data.ready };
    case 'start': {
      const countdownMs = duration(data.countdownMs, 10_000);
      const durationMs = duration(data.durationMs, 10 * 60_000);
      if (countdownMs === null || durationMs === null || durationMs === 0) return null;
      return { type: 'start', countdownMs, durationMs };
    }
    case 'reps':
    case 'final': {
      const reps = repCount(data.reps);
      if (reps === null) return null;
      return { type: data.type, reps };
    }
    case 'rematch':
      return { type: 'rematch' };
    default:
      return null;
  }
}
