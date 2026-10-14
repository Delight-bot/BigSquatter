/**
 * Live versus: a timed squat sprint between two phones.
 *
 * This is the whole match as a pure reducer — `(state, event, now) → (state,
 * messages to send)` — so every rule is unit-testable without a network, a
 * camera or React. The transport only delivers events in and messages out.
 *
 * Timing: the host decides when the match starts and tells the guest, and each
 * side then runs its own clock from the moment it heard. The two clocks are
 * offset by one network hop (tens of milliseconds), which is fair enough for a
 * 60-second sprint and avoids any clock-sync handshake. When a player's clock
 * runs out they send their final count; the result is shown once both finals
 * are in, so neither side declares a winner off a stale opponent count.
 */

import { cleanName, PROTOCOL_VERSION, type Message } from './protocol';

export const COUNTDOWN_MS = 3_000;
export const DEFAULT_DURATION_MS = 60_000;

export type Role = 'host' | 'guest';

export type MatchPhase =
  /** Channel not open yet, or open but no hello received. */
  | 'waiting'
  /** Both connected; each player gets in frame and taps ready. */
  | 'lobby'
  | 'countdown'
  | 'live'
  /** My clock ran out; waiting for the opponent's final count. */
  | 'awaiting-final'
  | 'finished'
  /** The match can't continue. See `endReason`. */
  | 'abandoned';

export interface Player {
  name: string;
  reps: number;
  ready: boolean;
  /** True once this player's final count is locked in. */
  final: boolean;
}

export interface MatchState {
  role: Role;
  phase: MatchPhase;
  me: Player;
  opponent: Player | null;
  opponentConnected: boolean;
  durationMs: number;
  /** Local `performance.now()` instants; null until a start is agreed. */
  startsAt: number | null;
  endsAt: number | null;
  endReason: 'left' | 'version' | null;
}

export type MatchEvent =
  | { type: 'connected' }
  | { type: 'disconnected' }
  | { type: 'message'; message: Message }
  | { type: 'set-ready'; ready: boolean }
  | { type: 'rep' }
  | { type: 'tick' }
  | { type: 'rematch' };

export interface Step {
  state: MatchState;
  send: Message[];
}

function freshPlayer(name: string): Player {
  return { name, reps: 0, ready: false, final: false };
}

export function createMatch(
  role: Role,
  name: string,
  durationMs: number = DEFAULT_DURATION_MS,
): MatchState {
  return {
    role,
    phase: 'waiting',
    me: freshPlayer(cleanName(name)),
    opponent: null,
    opponentConnected: false,
    durationMs,
    startsAt: null,
    endsAt: null,
    endReason: null,
  };
}

/** Back to the lobby with scores zeroed, keeping both players. */
function resetForRematch(state: MatchState): MatchState {
  return {
    ...state,
    phase: 'lobby',
    me: freshPlayer(state.me.name),
    opponent: state.opponent ? freshPlayer(state.opponent.name) : null,
    startsAt: null,
    endsAt: null,
  };
}

/** Host only: once both players are ready, start the countdown on both sides. */
function maybeStart(state: MatchState, now: number): Step {
  if (state.role !== 'host' || state.phase !== 'lobby') return { state, send: [] };
  if (!state.me.ready || !state.opponent?.ready) return { state, send: [] };
  const startsAt = now + COUNTDOWN_MS;
  return {
    state: { ...state, phase: 'countdown', startsAt, endsAt: startsAt + state.durationMs },
    send: [{ type: 'start', countdownMs: COUNTDOWN_MS, durationMs: state.durationMs }],
  };
}

function onMessage(state: MatchState, message: Message, now: number): Step {
  const none = { state, send: [] };
  switch (message.type) {
    case 'hello': {
      if (message.v !== PROTOCOL_VERSION) {
        return { state: { ...state, phase: 'abandoned', endReason: 'version' }, send: [] };
      }
      const opponent = state.opponent
        ? { ...state.opponent, name: message.name }
        : freshPlayer(message.name);
      const phase = state.phase === 'waiting' ? 'lobby' : state.phase;
      return { state: { ...state, opponent, opponentConnected: true, phase }, send: [] };
    }
    case 'ready': {
      if (state.phase !== 'lobby' || !state.opponent) return none;
      return maybeStart(
        { ...state, opponent: { ...state.opponent, ready: message.ready } },
        now,
      );
    }
    case 'start': {
      // Only the host starts matches; a guest's start, or one mid-match, is ignored.
      if (state.role !== 'guest' || state.phase !== 'lobby') return none;
      const startsAt = now + message.countdownMs;
      return {
        state: {
          ...state,
          phase: 'countdown',
          durationMs: message.durationMs,
          startsAt,
          endsAt: startsAt + message.durationMs,
        },
        send: [],
      };
    }
    case 'reps': {
      const opponent = state.opponent;
      if (!opponent || opponent.final) return none;
      if (state.phase !== 'live' && state.phase !== 'awaiting-final') return none;
      // max(): a count never goes backwards, whatever order updates arrive in.
      return {
        state: { ...state, opponent: { ...opponent, reps: Math.max(opponent.reps, message.reps) } },
        send: [],
      };
    }
    case 'final': {
      const opponent = state.opponent;
      if (!opponent || opponent.final) return none;
      if (!['countdown', 'live', 'awaiting-final'].includes(state.phase)) return none;
      const next = { ...state, opponent: { ...opponent, reps: message.reps, final: true } };
      if (state.phase === 'awaiting-final') next.phase = 'finished';
      return { state: next, send: [] };
    }
    case 'rematch':
      return state.phase === 'finished' ? { state: resetForRematch(state), send: [] } : none;
  }
}

export function reduceMatch(state: MatchState, event: MatchEvent, now: number): Step {
  const none = { state, send: [] };
  if (state.phase === 'abandoned') return none;

  switch (event.type) {
    case 'connected':
      return {
        state,
        send: [{ type: 'hello', v: PROTOCOL_VERSION, name: state.me.name }],
      };

    case 'disconnected':
      // A finished result stands; only rematch needs the other player.
      if (state.phase === 'finished') return { state: { ...state, opponentConnected: false }, send: [] };
      return {
        state: { ...state, phase: 'abandoned', opponentConnected: false, endReason: 'left' },
        send: [],
      };

    case 'message':
      return onMessage(state, event.message, now);

    case 'set-ready': {
      if (state.phase !== 'lobby' || state.me.ready === event.ready) return none;
      const next = maybeStart({ ...state, me: { ...state.me, ready: event.ready } }, now);
      return { state: next.state, send: [{ type: 'ready', ready: event.ready }, ...next.send] };
    }

    case 'rep': {
      if (state.phase !== 'live' || state.endsAt === null || now >= state.endsAt) return none;
      const reps = state.me.reps + 1;
      return { state: { ...state, me: { ...state.me, reps } }, send: [{ type: 'reps', reps }] };
    }

    case 'tick': {
      if (state.phase === 'countdown' && state.startsAt !== null && now >= state.startsAt) {
        // Fall through to the end-of-clock check in case a tick was badly delayed.
        return reduceMatch({ ...state, phase: 'live' }, event, now);
      }
      if (state.phase === 'live' && state.endsAt !== null && now >= state.endsAt) {
        const opponentDone = state.opponent?.final ?? false;
        return {
          state: {
            ...state,
            phase: opponentDone ? 'finished' : 'awaiting-final',
            me: { ...state.me, final: true },
          },
          send: [{ type: 'final', reps: state.me.reps }],
        };
      }
      return none;
    }

    case 'rematch':
      if (state.phase !== 'finished' || !state.opponentConnected) return none;
      return { state: resetForRematch(state), send: [{ type: 'rematch' }] };
  }
}

export type Outcome = 'win' | 'lose' | 'draw';

export function outcome(state: MatchState): Outcome | null {
  if (state.phase !== 'finished' || !state.opponent) return null;
  if (state.me.reps === state.opponent.reps) return 'draw';
  return state.me.reps > state.opponent.reps ? 'win' : 'lose';
}

/** Whole seconds left on the clock (or the countdown), for display. */
export function secondsLeft(state: MatchState, now: number): number {
  const until =
    state.phase === 'countdown' ? state.startsAt : state.phase === 'live' ? state.endsAt : null;
  if (until === null) return 0;
  return Math.max(0, Math.ceil((until - now) / 1000));
}
