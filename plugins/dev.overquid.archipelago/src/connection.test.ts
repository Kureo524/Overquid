import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection, RETRY_DELAYS, type Socket } from './connection';

class FakeSocket implements Socket {
  onmessage: Socket['onmessage'] = null;
  onclose: Socket['onclose'] = null;
  sent: unknown[] = [];
  closed = false;
  send(data: string) {
    this.sent.push(...(JSON.parse(data) as unknown[]));
  }
  close() {
    this.closed = true;
  }
  /** The server sends commands. */
  push(...commands: object[]) {
    this.onmessage?.({ data: JSON.stringify(commands) } as MessageEvent);
  }
  /** The server goes away. */
  drop() {
    this.onclose?.({} as CloseEvent);
  }
}

let sockets: FakeSocket[] = [];
const events = { change: vi.fn(), received: vi.fn() };

function open() {
  return new Connection(
    'wss://archipelago.gg:1',
    { name: 'Kuko', password: '', uuid: 'u' },
    events,
    () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  );
}

const last = () => sockets[sockets.length - 1] as FakeSocket;

function join() {
  last().push({ cmd: 'RoomInfo', seed_name: 's', games: [] });
  last().push({ cmd: 'DataPackage', data: { games: {} } });
  last().push({ cmd: 'Connected', team: 0, slot: 1, players: [], slot_info: {} });
}

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  events.change.mockClear();
  events.received.mockClear();
});
afterEach(() => vi.useRealTimers());

describe('Connection', () => {
  it('goes online once the room lets it in', () => {
    const connection = open();
    expect(connection.status).toBe('connecting');
    join();
    expect(connection.status).toBe('online');
    expect(last().sent.map((p) => (p as { cmd: string }).cmd)).toEqual([
      'GetDataPackage',
      'Connect',
      'Get',
      'SetNotify',
    ]);
    connection.say('!hint Hookshot');
    expect(last().sent.at(-1)).toEqual({ cmd: 'Say', text: '!hint Hookshot' });
  });

  it('gives up at once when the room never answered', () => {
    const connection = open();
    last().drop();
    expect(connection.status).toBe('offline');
    expect(connection.error).toMatch(/Could not reach/);
    vi.runAllTimers();
    expect(sockets).toHaveLength(1);
  });

  it('retries a dropped connection a few times, then stops', () => {
    const connection = open();
    join();
    for (const delay of RETRY_DELAYS) {
      last().drop();
      expect(connection.status).toBe('reconnecting');
      vi.advanceTimersByTime(delay);
    }
    expect(sockets).toHaveLength(RETRY_DELAYS.length + 1);
    last().drop();
    expect(connection.status).toBe('offline');
    expect(connection.error).toBe('Connection lost.');
    connection.retry();
    expect(connection.status).toBe('connecting');
    join();
    expect(connection.status).toBe('online');
  });

  it('starts counting again after a successful reconnection', () => {
    const connection = open();
    join();
    last().drop();
    vi.advanceTimersByTime(RETRY_DELAYS[0] as number);
    join();
    expect(connection.status).toBe('online');
    last().drop();
    vi.advanceTimersByTime(RETRY_DELAYS[0] as number);
    expect(sockets).toHaveLength(3);
  });

  it('stops on a refusal, and when the user disconnects', () => {
    const refused = open();
    last().push({ cmd: 'ConnectionRefused', errors: ['InvalidSlot'] });
    expect(refused.status).toBe('offline');
    expect(refused.error).toBe('No player with this slot name in the room.');
    expect(last().closed).toBe(true);

    const left = open();
    join();
    left.close();
    last().drop();
    vi.runAllTimers();
    expect(left.status).toBe('offline');
    expect(sockets).toHaveLength(2);
  });

  it('passes new items on', () => {
    open();
    join();
    last().push({ cmd: 'ReceivedItems', index: 0, items: [] });
    expect(events.received).not.toHaveBeenCalled();
    last().push({
      cmd: 'ReceivedItems',
      index: 1,
      items: [{ item: 1, location: 2, player: 2, flags: 0 }],
    });
    expect(events.received).toHaveBeenCalledWith([{ item: 1, location: 2, player: 2, flags: 0 }]);
  });
});
