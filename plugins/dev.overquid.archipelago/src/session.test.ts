import { describe, expect, it } from 'vitest';
import { Session } from './session';
import { parseSettings } from './settings';

const credentials = { name: 'Kuko', password: 'pw', uuid: 'u-1' };
const packet = (...commands: object[]) => JSON.stringify(commands);

const ROOM_INFO = {
  cmd: 'RoomInfo',
  seed_name: 'seed-1',
  hint_cost: 10,
  games: ['Game A', 'Game B'],
};
const DATA_PACKAGE = {
  cmd: 'DataPackage',
  data: {
    games: {
      'Game A': {
        item_name_to_id: { Hookshot: 1, Rupee: 2 },
        location_name_to_id: { 'Boss Chest': 40 },
      },
      // Same ids as Game A: names are per game.
      'Game B': { item_name_to_id: { Sword: 1 }, location_name_to_id: { 'Minigame Prize': 40 } },
      Archipelago: { item_name_to_id: {}, location_name_to_id: { Server: -2 } },
    },
  },
};
const CONNECTED = {
  cmd: 'Connected',
  team: 0,
  slot: 1,
  players: [
    { team: 0, slot: 1, alias: 'Kuko', name: 'Kuko' },
    { team: 0, slot: 2, alias: 'Bob the friend', name: 'Bob' },
    { team: 1, slot: 1, alias: 'Other team', name: 'X' },
  ],
  slot_info: { '1': { name: 'Kuko', game: 'Game A' }, '2': { name: 'Bob', game: 'Game B' } },
  checked_locations: [40],
  missing_locations: [41, 42, 43],
  hint_points: 4,
};

function joined() {
  const session = new Session(credentials);
  session.receive(packet(ROOM_INFO));
  session.receive(packet(DATA_PACKAGE));
  session.receive(packet(CONNECTED));
  return session;
}

describe('Session', () => {
  it('asks for the names of the room games, then connects as a text client', () => {
    const session = new Session(credentials);
    expect(session.receive(packet(ROOM_INFO)).send).toEqual([
      { cmd: 'GetDataPackage', games: ['Game A', 'Game B', 'Archipelago'] },
    ]);
    expect(session.receive(packet(DATA_PACKAGE)).send).toEqual([
      {
        cmd: 'Connect',
        game: '',
        name: 'Kuko',
        password: 'pw',
        uuid: 'u-1',
        version: { major: 0, minor: 6, build: 8, class: 'Version' },
        items_handling: 0b111,
        tags: ['TextOnly'],
        slot_data: false,
      },
    ]);
    const { send } = session.receive(packet(CONNECTED));
    expect(session.connected).toBe(true);
    expect(send).toEqual([
      { cmd: 'Get', keys: ['_read_hints_0_1'] },
      { cmd: 'SetNotify', keys: ['_read_hints_0_1'] },
    ]);
    expect(session.checked.size).toBe(1);
    expect(session.locations).toBe(4);
    expect(session.hintPrice).toBe(1);
  });

  it('keeps the names when it reconnects to the same seed', () => {
    const session = joined();
    session.reset();
    expect(session.receive(packet(ROOM_INFO)).send[0]).toMatchObject({ cmd: 'Connect' });
  });

  it('resolves names in the game of the right world', () => {
    const session = joined();
    expect(session.itemName(1, 1)).toBe('Hookshot');
    expect(session.itemName(1, 2)).toBe('Sword');
    expect(session.locationName(40, 2)).toBe('Minigame Prize');
    expect(session.locationName(-2, 2)).toBe('Server');
    expect(session.itemName(99, 1)).toBe('Unknown item 99');
    expect(session.playerName(2)).toBe('Bob the friend');
    expect(session.playerName(0)).toBe('Archipelago');
  });

  it('turns messages into parts with names', () => {
    const session = joined();
    session.receive(
      packet({
        cmd: 'PrintJSON',
        type: 'ItemSend',
        data: [
          { type: 'player_id', text: '2' },
          { text: ' sent ' },
          { type: 'item_id', text: '1', player: 1, flags: 1 },
          { text: ' to ' },
          { type: 'player_id', text: '1' },
          { text: ' (' },
          { type: 'location_id', text: '40', player: 2 },
          { text: ')' },
          { type: 'color', text: '!', color: 'red' },
        ],
      }),
    );
    expect(session.log).toEqual([
      {
        id: 1,
        type: 'ItemSend',
        parts: [
          { text: 'Bob the friend', kind: 'player' },
          { text: ' sent ', kind: 'text' },
          { text: 'Hookshot', kind: 'item', flags: 1 },
          { text: ' to ', kind: 'text' },
          { text: 'Kuko', kind: 'self' },
          { text: ' (', kind: 'text' },
          { text: 'Minigame Prize', kind: 'location' },
          { text: ')', kind: 'text' },
          { text: '!', kind: 'color', color: 'red' },
        ],
      },
    ]);
  });

  it('announces items received after the first sync, from other worlds only', () => {
    const session = joined();
    const first = session.receive(
      packet({
        cmd: 'ReceivedItems',
        index: 0,
        items: [{ item: 2, location: -2, player: 0, flags: 0 }],
      }),
    );
    expect(first.received).toEqual([]);
    const next = session.receive(
      packet({
        cmd: 'ReceivedItems',
        index: 1,
        items: [
          { item: 1, location: 40, player: 2, flags: 1 },
          { item: 2, location: 40, player: 1, flags: 0 },
        ],
      }),
    );
    expect(next.received).toEqual([{ item: 1, location: 40, player: 2, flags: 1 }]);
    expect(session.items).toHaveLength(3);
    expect(session.announce(next.received)).toEqual({
      title: 'Hookshot',
      body: 'From Bob the friend (Minigame Prize)',
    });
    const many = Array.from({ length: 5 }, (_, i) => ({
      item: 2 - (i === 4 ? 1 : 0),
      location: 40,
      player: 2,
      flags: i === 4 ? 1 : 0,
    }));
    expect(session.announce(many)).toEqual({
      title: '5 items received',
      body: 'Hookshot, Rupee, Rupee and 2 more',
    });
  });

  it('follows hints, points and checks', () => {
    const session = joined();
    const hint = {
      receiving_player: 1,
      finding_player: 2,
      location: 40,
      item: 1,
      found: false,
      entrance: '',
      item_flags: 1,
      status: 30,
      class: 'Hint',
    };
    session.receive(packet({ cmd: 'Retrieved', keys: { _read_hints_0_1: [hint] } }));
    expect(session.hints).toEqual([
      {
        receivingPlayer: 1,
        findingPlayer: 2,
        location: 40,
        item: 1,
        found: false,
        entrance: '',
        itemFlags: 1,
        status: 30,
      },
    ]);
    session.receive(
      packet({ cmd: 'SetReply', key: '_read_hints_0_1', value: [{ ...hint, found: true }] }),
    );
    expect(session.hints[0]?.found).toBe(true);
    session.receive(packet({ cmd: 'RoomUpdate', hint_points: 9, checked_locations: [41, 40] }));
    expect(session.hintPoints).toBe(9);
    expect(session.checked.size).toBe(2);
  });

  it('explains a refusal', () => {
    const session = new Session(credentials);
    expect(
      session.receive(packet({ cmd: 'ConnectionRefused', errors: ['InvalidPassword'] })).refused,
    ).toBe('Wrong password.');
    expect(session.receive(packet({ cmd: 'ConnectionRefused' })).refused).toBe(
      'The room refused to connect.',
    );
  });

  it('ignores what is not a list of commands', () => {
    const session = new Session(credentials);
    for (const data of ['nope', '{"cmd":"RoomInfo"}', '[1, null, {"no":"cmd"}]', 42]) {
      expect(session.receive(data)).toEqual({ send: [], received: [] });
    }
  });

  it('keeps the log to its size', () => {
    const session = new Session(credentials);
    for (let i = 0; i < 510; i++) session.note(String(i));
    expect(session.log).toHaveLength(500);
    expect(session.log[0]?.parts[0]?.text).toBe('10');
  });
});

describe('parseSettings', () => {
  it('reads stored settings, or starts afresh with a new client id', () => {
    expect(parseSettings(null, () => 'new')).toEqual({
      server: '',
      name: '',
      password: '',
      notify: true,
      rejoin: false,
      uuid: 'new',
    });
    expect(
      parseSettings(
        { server: 'archipelago.gg:1', name: 7, notify: false, rejoin: true, uuid: 'old' },
        () => 'new',
      ),
    ).toMatchObject({
      server: 'archipelago.gg:1',
      name: '',
      notify: false,
      rejoin: true,
      uuid: 'old',
    });
  });
});
