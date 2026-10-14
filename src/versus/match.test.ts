import { describe, expect, it } from 'vitest';
import {
  COUNTDOWN_MS,
  createMatch,
  outcome,
  reduceMatch,
  secondsLeft,
  type MatchEvent,
  type MatchState,
} from './match';
import { PROTOCOL_VERSION, type Message } from './protocol';

const DURATION = 10_000;

/**
 * Two reducers wired back to back, standing in for two phones. Messages are
 * delivered instantly unless a test holds them, so each side's clock is the
 * shared `now` — the real offset is one network hop, which no rule depends on.
 */
class Pair {
  host: MatchState = createMatch('host', 'Hana', DURATION);
  guest: MatchState = createMatch('guest', 'Gus', DURATION);
  now = 0;
  /** Messages in flight, held instead of delivered while `paused`. */
  queued: { to: 'host' | 'guest'; message: Message }[] = [];
  paused = false;

  apply(side: 'host' | 'guest', event: MatchEvent): void {
    const step = reduceMatch(this[side], event, this.now);
    this[side] = step.state;
    const to = side === 'host' ? 'guest' : 'host';
    for (const message of step.send) {
      if (this.paused) this.queued.push({ to, message });
      else this.apply(to, { type: 'message', message });
    }
  }

  flush(): void {
    this.paused = false;
    const pending = this.queued;
    this.queued = [];
    for (const { to, message } of pending) this.apply(to, { type: 'message', message });
  }

  connect(): void {
    this.apply('host', { type: 'connected' });
    this.apply('guest', { type: 'connected' });
  }

  readyUp(): void {
    this.apply('host', { type: 'set-ready', ready: true });
    this.apply('guest', { type: 'set-ready', ready: true });
  }

  advance(ms: number): void {
    this.now += ms;
    this.apply('host', { type: 'tick' });
    this.apply('guest', { type: 'tick' });
  }

  reps(side: 'host' | 'guest', count: number): void {
    for (let i = 0; i < count; i += 1) this.apply(side, { type: 'rep' });
  }

  /** Connect, ready, and run the countdown so both sides are live. */
  startLive(): void {
    this.connect();
    this.readyUp();
    this.advance(COUNTDOWN_MS);
  }
}

describe('connecting', () => {
  it('waits for a hello before entering the lobby', () => {
    const pair = new Pair();
    expect(pair.host.phase).toBe('waiting');
    pair.connect();
    expect(pair.host.phase).toBe('lobby');
    expect(pair.guest.phase).toBe('lobby');
    expect(pair.host.opponent?.name).toBe('Gus');
    expect(pair.guest.opponent?.name).toBe('Hana');
  });

  it('abandons on a protocol version mismatch', () => {
    const host = createMatch('host', 'Hana');
    const { state } = reduceMatch(
      host,
      { type: 'message', message: { type: 'hello', v: PROTOCOL_VERSION + 1, name: 'Gus' } },
      0,
    );
    expect(state.phase).toBe('abandoned');
    expect(state.endReason).toBe('version');
  });
});

describe('starting', () => {
  it('starts only once both players are ready', () => {
    const pair = new Pair();
    pair.connect();
    pair.apply('host', { type: 'set-ready', ready: true });
    expect(pair.host.phase).toBe('lobby');
    pair.apply('guest', { type: 'set-ready', ready: true });
    expect(pair.host.phase).toBe('countdown');
    expect(pair.guest.phase).toBe('countdown');
  });

  it('starts whichever player readies last', () => {
    const pair = new Pair();
    pair.connect();
    pair.apply('guest', { type: 'set-ready', ready: true });
    pair.apply('host', { type: 'set-ready', ready: true });
    expect(pair.guest.phase).toBe('countdown');
  });

  it('does not start if a player un-readies first', () => {
    const pair = new Pair();
    pair.connect();
    pair.apply('host', { type: 'set-ready', ready: true });
    pair.apply('host', { type: 'set-ready', ready: false });
    pair.apply('guest', { type: 'set-ready', ready: true });
    expect(pair.host.phase).toBe('lobby');
  });

  it('ignores a start message sent to the host', () => {
    const pair = new Pair();
    pair.connect();
    pair.apply('host', {
      type: 'message',
      message: { type: 'start', countdownMs: 0, durationMs: 1000 },
    });
    expect(pair.host.phase).toBe('lobby');
  });

  it('goes live when the countdown ends', () => {
    const pair = new Pair();
    pair.connect();
    pair.readyUp();
    pair.advance(COUNTDOWN_MS - 1);
    expect(pair.host.phase).toBe('countdown');
    expect(secondsLeft(pair.host, pair.now)).toBe(1);
    pair.advance(1);
    expect(pair.host.phase).toBe('live');
    expect(pair.guest.phase).toBe('live');
  });
});

describe('scoring', () => {
  it('ignores reps before the match is live', () => {
    const pair = new Pair();
    pair.connect();
    pair.reps('host', 3);
    pair.readyUp();
    pair.reps('host', 3);
    expect(pair.host.me.reps).toBe(0);
  });

  it('mirrors each rep to the opponent', () => {
    const pair = new Pair();
    pair.startLive();
    pair.reps('host', 4);
    pair.reps('guest', 2);
    expect(pair.host.me.reps).toBe(4);
    expect(pair.guest.opponent?.reps).toBe(4);
    expect(pair.host.opponent?.reps).toBe(2);
  });

  it('never lets an out-of-order update lower a score', () => {
    const pair = new Pair();
    pair.startLive();
    pair.reps('guest', 5);
    pair.apply('host', { type: 'message', message: { type: 'reps', reps: 3 } });
    expect(pair.host.opponent?.reps).toBe(5);
  });

  it('ignores reps after the clock runs out', () => {
    const pair = new Pair();
    pair.startLive();
    pair.reps('host', 2);
    pair.now += DURATION;
    // A rep that lands between the deadline and the next tick must not count.
    pair.apply('host', { type: 'rep' });
    expect(pair.host.me.reps).toBe(2);
  });
});

describe('finishing', () => {
  it('declares a winner once both finals are in', () => {
    const pair = new Pair();
    pair.startLive();
    pair.reps('host', 7);
    pair.reps('guest', 5);
    pair.advance(DURATION);
    expect(pair.host.phase).toBe('finished');
    expect(pair.guest.phase).toBe('finished');
    expect(outcome(pair.host)).toBe('win');
    expect(outcome(pair.guest)).toBe('lose');
  });

  it('calls a tie a draw', () => {
    const pair = new Pair();
    pair.startLive();
    pair.reps('host', 3);
    pair.reps('guest', 3);
    pair.advance(DURATION);
    expect(outcome(pair.host)).toBe('draw');
  });

  it("waits for the opponent's final rather than trusting a stale count", () => {
    const pair = new Pair();
    pair.startLive();
    pair.reps('host', 4);
    pair.paused = true;
    pair.reps('guest', 6); // Still in flight when the host's clock ends.
    pair.now += DURATION;
    pair.apply('host', { type: 'tick' });
    expect(pair.host.phase).toBe('awaiting-final');
    expect(outcome(pair.host)).toBeNull();

    pair.apply('guest', { type: 'tick' });
    pair.flush();
    expect(pair.host.phase).toBe('finished');
    expect(pair.host.opponent?.reps).toBe(6);
    expect(outcome(pair.host)).toBe('lose');
  });

  it('handles the opponent finishing first', () => {
    const pair = new Pair();
    pair.startLive();
    pair.reps('guest', 2);
    pair.now += DURATION;
    pair.apply('guest', { type: 'tick' });
    expect(pair.host.phase).toBe('live');
    expect(pair.host.opponent?.final).toBe(true);
    pair.apply('host', { type: 'tick' });
    expect(pair.host.phase).toBe('finished');
  });

  it('survives a tick delayed past both the countdown and the deadline', () => {
    const pair = new Pair();
    pair.connect();
    pair.readyUp();
    pair.advance(COUNTDOWN_MS + DURATION + 5_000);
    expect(pair.host.phase).toBe('finished');
  });
});

describe('disconnects', () => {
  it('abandons a match in progress', () => {
    const pair = new Pair();
    pair.startLive();
    pair.reps('host', 3);
    pair.apply('host', { type: 'disconnected' });
    expect(pair.host.phase).toBe('abandoned');
    expect(pair.host.endReason).toBe('left');
    // The reps already done are not taken away.
    expect(pair.host.me.reps).toBe(3);
  });

  it('keeps a finished result but blocks the rematch', () => {
    const pair = new Pair();
    pair.startLive();
    pair.advance(DURATION);
    pair.apply('host', { type: 'disconnected' });
    expect(pair.host.phase).toBe('finished');
    pair.apply('host', { type: 'rematch' });
    expect(pair.host.phase).toBe('finished');
  });
});

describe('rematch', () => {
  it('resets both sides to the lobby with scores zeroed', () => {
    const pair = new Pair();
    pair.startLive();
    pair.reps('host', 5);
    pair.advance(DURATION);
    pair.apply('guest', { type: 'rematch' });
    for (const side of [pair.host, pair.guest]) {
      expect(side.phase).toBe('lobby');
      expect(side.me.reps).toBe(0);
      expect(side.me.ready).toBe(false);
      expect(side.opponent?.reps).toBe(0);
    }
  });

  it('copes with both players pressing rematch at once', () => {
    const pair = new Pair();
    pair.startLive();
    pair.advance(DURATION);
    pair.paused = true;
    pair.apply('host', { type: 'rematch' });
    pair.apply('guest', { type: 'rematch' });
    pair.flush();
    expect(pair.host.phase).toBe('lobby');
    expect(pair.guest.phase).toBe('lobby');

    pair.readyUp();
    pair.advance(COUNTDOWN_MS);
    expect(pair.host.phase).toBe('live');
  });
});
