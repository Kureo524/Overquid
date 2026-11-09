/**
 * The WebSocket to a room, around a `Session`. A dropped connection is retried
 * a few times; a refusal or a disconnect asked by the user is not.
 */

import type { Packet } from './protocol';
import { Session, type Credentials, type Output } from './session';

export type Status = 'connecting' | 'online' | 'reconnecting' | 'offline';

/** The subset of `WebSocket` we use, so tests can pass a fake. */
export interface Socket {
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface Events {
  /** Something in the session or the status changed. */
  change(): void;
  /** Items from other worlds arrived. */
  received(output: Output['received']): void;
}

/** Waits before each new attempt after a drop (ms); then we give up. */
export const RETRY_DELAYS = [1000, 2000, 5000, 10_000, 20_000, 30_000, 30_000, 30_000];

export class Connection {
  readonly session: Session;
  status: Status = 'connecting';
  /** Why we are offline, for the user. */
  error = '';
  /** We got into the room at least once. */
  joined = false;
  private socket: Socket | null = null;
  private retries = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    readonly url: string,
    credentials: Credentials,
    private readonly events: Events,
    private readonly open: (url: string) => Socket = (url) => new WebSocket(url),
  ) {
    this.session = new Session(credentials);
    this.dial();
  }

  /** Sends a chat message or a `!` command. */
  say(text: string) {
    if (this.status === 'online') this.send([{ cmd: 'Say', text }]);
  }

  /** Stops for good. */
  close() {
    clearTimeout(this.timer);
    this.status = 'offline';
    this.drop();
  }

  /** Tries again now, after giving up. */
  retry() {
    if (this.status !== 'offline') return;
    this.retries = 0;
    this.status = 'connecting';
    this.error = '';
    this.dial();
    this.events.change();
  }

  private dial() {
    this.session.reset();
    let socket: Socket;
    try {
      socket = this.open(this.url);
    } catch (error) {
      // WebKit throws when the plugin's CSP blocks the address: retrying
      // would not help. Reported after the caller's own update.
      console.error('Archipelago:', error);
      this.status = 'offline';
      this.error = 'The overlay blocked the connection to this address.';
      queueMicrotask(() => this.events.change());
      return;
    }
    this.socket = socket;
    socket.onmessage = ({ data }) => {
      const output = this.session.receive(data);
      if (output.send.length > 0) this.send(output.send);
      if (output.refused !== undefined) {
        this.error = output.refused;
        this.close();
      } else if (this.session.connected && this.status !== 'online') {
        this.status = 'online';
        this.joined = true;
        this.retries = 0;
      }
      if (output.received.length > 0) this.events.received(output.received);
      this.events.change();
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.lost();
    };
  }

  private lost() {
    const delay = RETRY_DELAYS[this.retries];
    if (this.status === 'offline') return;
    if (this.status === 'connecting') {
      // A room that never let us in is probably not running: no retry.
      this.status = 'offline';
      this.error = 'Could not reach the room. Is it running, and is the port right?';
    } else if (delay === undefined) {
      this.status = 'offline';
      this.error = 'Connection lost.';
    } else {
      this.retries += 1;
      this.status = 'reconnecting';
      this.timer = setTimeout(() => this.dial(), delay);
    }
    this.events.change();
  }

  private send(packets: Packet[]) {
    this.socket?.send(JSON.stringify(packets));
  }

  private drop() {
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }
}
