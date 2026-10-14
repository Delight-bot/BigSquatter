/**
 * Runs one versus match: owns the transport, feeds its events through the pure
 * reducer, and sends whatever the reducer says to send.
 *
 * The match lives in a ref as well as in state because events arrive from
 * network callbacks and the camera's frame loop, and each must apply on top of
 * the previous one immediately — not on top of whatever React last rendered.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createMatch, reduceMatch, type MatchEvent, type MatchState, type Role } from './match';
import {
  generateCode,
  hostMatch,
  joinMatch,
  type Transport,
  type TransportError,
} from './transport';

const TICK_MS = 100;
/** A guest who hasn't heard back by now is almost certainly not going to. */
const JOIN_TIMEOUT_MS = 15_000;

export interface UseVersusMatch {
  match: MatchState | null;
  code: string | null;
  error: TransportError | null;
  /** `performance.now()` as of the last tick, for clock displays. */
  now: number;
  host: (name: string) => void;
  join: (code: string, name: string) => void;
  /** Applies an event and returns the resulting match state. */
  dispatch: (event: MatchEvent) => MatchState | null;
  leave: () => void;
}

export function useVersusMatch(): UseVersusMatch {
  const [match, setMatch] = useState<MatchState | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<TransportError | null>(null);
  const [now, setNow] = useState(() => performance.now());

  const matchRef = useRef<MatchState | null>(null);
  const transportRef = useRef<Transport | null>(null);

  const dispatch = useCallback((event: MatchEvent) => {
    const current = matchRef.current;
    if (!current) return null;
    const step = reduceMatch(current, event, performance.now());
    matchRef.current = step.state;
    if (step.state !== current) setMatch(step.state);
    for (const message of step.send) transportRef.current?.send(message);
    return step.state;
  }, []);

  const leave = useCallback(() => {
    transportRef.current?.close();
    transportRef.current = null;
    matchRef.current = null;
    setMatch(null);
    setCode(null);
  }, []);

  const begin = useCallback(
    function open(role: Role, matchCode: string, name: string) {
      leave();
      const initial = createMatch(role, name);
      matchRef.current = initial;
      setMatch(initial);
      setCode(matchCode);
      setError(null);

      transportRef.current = (role === 'host' ? hostMatch : joinMatch)(matchCode, {
        onOpen: () => dispatch({ type: 'connected' }),
        onMessage: (message) => dispatch({ type: 'message', message }),
        onClose: () => dispatch({ type: 'disconnected' }),
        onError: (err) => {
          // A five-letter code collides rarely; just roll another.
          if (err === 'code-taken' && role === 'host') {
            open('host', generateCode(), name);
            return;
          }
          // Once a match is underway, any failure means the opponent is gone.
          if (matchRef.current && matchRef.current.phase !== 'waiting') {
            dispatch({ type: 'disconnected' });
            return;
          }
          transportRef.current?.close();
          transportRef.current = null;
          setError(err);
        },
      });
    },
    [dispatch, leave],
  );

  const host = useCallback((name: string) => begin('host', generateCode(), name), [begin]);
  const join = useCallback(
    (matchCode: string, name: string) => begin('guest', matchCode, name),
    [begin],
  );

  const phase = match?.phase;
  const role = match?.role;

  useEffect(() => {
    if (phase !== 'countdown' && phase !== 'live') return;
    const id = window.setInterval(() => {
      setNow(performance.now());
      dispatch({ type: 'tick' });
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [dispatch, phase]);

  useEffect(() => {
    if (phase !== 'waiting' || role !== 'guest') return;
    const id = window.setTimeout(() => {
      transportRef.current?.close();
      transportRef.current = null;
      setError('network');
    }, JOIN_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [phase, role]);

  // Close the connection if the screen unmounts mid-match.
  useEffect(() => leave, [leave]);

  return { match, code, error, now, host, join, dispatch, leave };
}
