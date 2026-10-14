/**
 * Peer-to-peer link between two phones, over a WebRTC data channel.
 *
 * There is no app backend: PeerJS's free public broker is used only to
 * introduce the two browsers (the host registers under an ID derived from the
 * match code, the guest dials it). After that, rep counts go phone-to-phone.
 * Only small JSON messages are ever sent — never video.
 *
 * PeerJS is imported lazily so it costs nothing until someone opens versus.
 */

import type { DataConnection, Peer } from 'peerjs';
import { parseMessage, type Message } from './protocol';

const ID_PREFIX = 'squat-challenge-vs-';
/** No 0/O, 1/I/L: codes get read aloud and typed on phone keyboards. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;

export type TransportError =
  /** Another match already holds this code; the host should pick a new one. */
  | 'code-taken'
  /** No host is waiting under the code the guest typed. */
  | 'no-match'
  | 'unsupported'
  | 'network';

export interface TransportHandlers {
  onOpen: () => void;
  onMessage: (message: Message) => void;
  onClose: () => void;
  onError: (error: TransportError) => void;
}

export interface Transport {
  send: (message: Message) => void;
  close: () => void;
}

export function generateCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

/** Uppercases and strips what people paste around a code; null if it can't be one. */
export function normaliseCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== CODE_LENGTH) return null;
  return [...code].every((c) => CODE_ALPHABET.includes(c)) ? code : null;
}

export function inviteLink(code: string, location: Location = window.location): string {
  return `${location.origin}${location.pathname}#/versus?join=${code}`;
}

function mapPeerError(type: string): TransportError {
  switch (type) {
    case 'unavailable-id':
      return 'code-taken';
    case 'peer-unavailable':
      return 'no-match';
    case 'browser-incompatible':
      return 'unsupported';
    default:
      return 'network';
  }
}

async function createPeer(id?: string): Promise<Peer> {
  const { Peer: PeerCtor } = await import('peerjs');
  return id ? new PeerCtor(id) : new PeerCtor();
}

function connect(
  role: 'host' | 'guest',
  code: string,
  handlers: TransportHandlers,
): Transport {
  let peer: Peer | null = null;
  let conn: DataConnection | null = null;
  let closed = false;

  const wire = (connection: DataConnection) => {
    conn = connection;
    connection.on('open', () => !closed && handlers.onOpen());
    connection.on('data', (data) => {
      const message = parseMessage(data);
      if (message && !closed) handlers.onMessage(message);
    });
    connection.on('close', () => !closed && handlers.onClose());
    connection.on('error', () => !closed && handlers.onError('network'));
  };

  void createPeer(role === 'host' ? ID_PREFIX + code : undefined)
    .then((created) => {
      if (closed) {
        created.destroy();
        return;
      }
      peer = created;
      created.on('error', (err) => !closed && handlers.onError(mapPeerError(err.type)));

      if (role === 'host') {
        created.on('connection', (incoming) => {
          // One opponent per match: turn away anyone else who finds the code.
          if (conn) {
            incoming.on('open', () => incoming.close());
            return;
          }
          wire(incoming);
        });
      } else {
        created.on('open', () => {
          if (!closed) wire(created.connect(ID_PREFIX + code, { reliable: true }));
        });
      }
    })
    .catch(() => !closed && handlers.onError('unsupported'));

  return {
    send: (message) => {
      if (conn?.open) void conn.send(message);
    },
    close: () => {
      closed = true;
      conn?.close();
      peer?.destroy();
    },
  };
}

export function hostMatch(code: string, handlers: TransportHandlers): Transport {
  return connect('host', code, handlers);
}

export function joinMatch(code: string, handlers: TransportHandlers): Transport {
  return connect('guest', code, handlers);
}
