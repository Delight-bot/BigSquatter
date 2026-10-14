import { describe, expect, it } from 'vitest';
import { cleanName, MAX_REPS, parseMessage } from './protocol';
import { generateCode, normaliseCode, CODE_LENGTH } from './transport';

describe('parseMessage', () => {
  it('accepts every well-formed message', () => {
    expect(parseMessage({ type: 'hello', v: 1, name: 'Ada' })).toEqual({
      type: 'hello',
      v: 1,
      name: 'Ada',
    });
    expect(parseMessage({ type: 'ready', ready: true })).toEqual({ type: 'ready', ready: true });
    expect(parseMessage({ type: 'start', countdownMs: 3000, durationMs: 60000 })).toBeTruthy();
    expect(parseMessage({ type: 'reps', reps: 4 })).toEqual({ type: 'reps', reps: 4 });
    expect(parseMessage({ type: 'final', reps: 0 })).toEqual({ type: 'final', reps: 0 });
    expect(parseMessage({ type: 'rematch' })).toEqual({ type: 'rematch' });
  });

  it.each([
    null,
    'reps',
    42,
    { type: 'nope' },
    { type: 'reps', reps: -1 },
    { type: 'reps', reps: 1.5 },
    { type: 'reps', reps: MAX_REPS + 1 },
    { type: 'reps', reps: '4' },
    { type: 'ready', ready: 'yes' },
    { type: 'hello', v: 1 },
    { type: 'start', countdownMs: 3000, durationMs: 0 },
    { type: 'start', countdownMs: Number.NaN, durationMs: 60000 },
    { type: 'start', countdownMs: 3000, durationMs: 24 * 60 * 60_000 },
  ])('rejects %j', (input) => {
    expect(parseMessage(input)).toBeNull();
  });

  it('drops fields it does not know about', () => {
    expect(parseMessage({ type: 'reps', reps: 2, admin: true })).toEqual({ type: 'reps', reps: 2 });
  });
});

describe('cleanName', () => {
  it('trims, collapses whitespace and caps length', () => {
    expect(cleanName('  Ada   Lovelace ')).toBe('Ada Lovelace');
    expect(cleanName('x'.repeat(100))).toHaveLength(24);
  });

  it('falls back when empty', () => {
    expect(cleanName('   ')).toBe('Friend');
  });
});

describe('match codes', () => {
  it('generates codes that survive normalisation', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateCode();
      expect(code).toHaveLength(CODE_LENGTH);
      expect(normaliseCode(code)).toBe(code);
    }
  });

  it('normalises what people actually type or paste', () => {
    expect(normaliseCode('abcde')).toBe('ABCDE');
    expect(normaliseCode(' AB-CDE ')).toBe('ABCDE');
  });

  it('rejects the wrong length and look-alike characters', () => {
    expect(normaliseCode('ABCD')).toBeNull();
    expect(normaliseCode('ABCDEF')).toBeNull();
    expect(normaliseCode('ABCD0')).toBeNull();
    expect(normaliseCode('ABCDI')).toBeNull();
  });
});
