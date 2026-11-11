import { sha256 } from './sha256';

/** obs-websocket 5 messages. */
const Op = { Hello: 0, Identify: 1, Identified: 2, Event: 5, Request: 6, Response: 7 } as const;

/** Events to receive: general, scenes, inputs and outputs. */
const EVENT_SUBSCRIPTIONS = (1 << 0) | (1 << 2) | (1 << 3) | (1 << 6);

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const hashed = (text: string) => toBase64(sha256(new TextEncoder().encode(text)));

/** The `authentication` string of the obs-websocket handshake. */
export const authenticationFor = (password: string, salt: string, challenge: string) =>
  hashed(hashed(password + salt) + challenge);

/** A password for an OBS the plugin starts itself: 24 random hex digits. */
export function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

type Pending = { resolve: (value: Record<string, unknown>) => void; reject: (e: Error) => void };

export interface ObsHandlers {
  onConnected: () => void;
  onClosed: (reason: string) => void;
  onEvent: (type: string, data: Record<string, unknown>) => void;
}

const REQUEST_TIMEOUT = 5000;

/** A connection to OBS on this machine. */
export class ObsConnection {
  private readonly socket: WebSocket;
  private readonly pending = new Map<string, Pending>();
  private nextRequest = 1;
  private closeReason = 'Connection closed';

  constructor(
    port: number,
    private readonly password: string,
    private readonly handlers: ObsHandlers,
  ) {
    this.socket = new WebSocket(`ws://127.0.0.1:${port}`);
    this.socket.addEventListener('message', (event) => this.onMessage(String(event.data)));
    this.socket.addEventListener('error', () => {
      this.closeReason = 'Cannot reach OBS on that port';
    });
    this.socket.addEventListener('close', (event) => {
      // 4009: wrong password, as obs-websocket defines it.
      if (event.code === 4009) this.closeReason = 'Wrong password';
      for (const request of this.pending.values()) request.reject(new Error('Disconnected'));
      this.pending.clear();
      this.handlers.onClosed(this.closeReason);
    });
  }

  close() {
    this.closeReason = 'Disconnected';
    this.socket.close();
  }

  private send(op: number, d: unknown) {
    this.socket.send(JSON.stringify({ op, d }));
  }

  private onMessage(text: string) {
    const message = JSON.parse(text) as { op: number; d: Record<string, unknown> };
    if (message.op === Op.Hello) {
      const auth = message.d.authentication as { salt: string; challenge: string } | undefined;
      this.send(Op.Identify, {
        rpcVersion: 1,
        eventSubscriptions: EVENT_SUBSCRIPTIONS,
        ...(auth
          ? { authentication: authenticationFor(this.password, auth.salt, auth.challenge) }
          : {}),
      });
    } else if (message.op === Op.Identified) {
      this.handlers.onConnected();
    } else if (message.op === Op.Event) {
      this.handlers.onEvent(
        message.d.eventType as string,
        (message.d.eventData ?? {}) as Record<string, unknown>,
      );
    } else if (message.op === Op.Response) {
      const request = this.pending.get(message.d.requestId as string);
      if (!request) return;
      this.pending.delete(message.d.requestId as string);
      const status = message.d.requestStatus as { result: boolean; comment?: string };
      if (status.result) request.resolve((message.d.responseData ?? {}) as Record<string, unknown>);
      else request.reject(new Error(status.comment ?? 'OBS refused the request'));
    }
  }

  request(requestType: string, requestData: Record<string, unknown> = {}) {
    const requestId = String(this.nextRequest++);
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.send(Op.Request, { requestType, requestId, requestData });
      setTimeout(() => {
        if (this.pending.delete(requestId)) reject(new Error('OBS did not answer'));
      }, REQUEST_TIMEOUT);
    });
  }
}
