/**
 * One connection to a room, as a text client: what the server tells us, and
 * what to answer. No socket here (see `connection.ts`), so it is unit tested
 * with plain packets.
 *
 * Handshake: RoomInfo → GetDataPackage → DataPackage → Connect → Connected.
 * We connect with the `TextOnly` tag, like Archipelago's own Text Client: no
 * game, nothing checked on our side, items and messages only.
 */

import {
  HINT_STATUS,
  PROGRESSION,
  VERSION,
  decode,
  hint,
  int,
  ints,
  list,
  messagePart,
  networkItem,
  record,
  str,
  type Hint,
  type MessagePart,
  type NetworkItem,
  type Packet,
} from './protocol';

export interface Credentials {
  name: string;
  password: string;
  /** Identifies this client to the server across sessions. */
  uuid: string;
}

/** A piece of a log line, with ids resolved to names. */
export interface Part {
  text: string;
  kind: 'text' | 'player' | 'self' | 'item' | 'location' | 'entrance' | 'status' | 'color';
  /** Item flags (`item`) or console color (`color`). */
  flags?: number;
  color?: string;
}

export interface Line {
  id: number;
  type: string;
  parts: Part[];
}

/** Lines kept in the log. */
export const LOG_SIZE = 500;
const ARCHIPELAGO = 'Archipelago';

export const REFUSALS: Record<string, string> = {
  InvalidSlot: 'No player with this slot name in the room.',
  InvalidGame: 'The room refused this client.',
  IncompatibleVersion: 'The room needs a newer Archipelago version.',
  InvalidPassword: 'Wrong password.',
  InvalidItemsHandling: 'The room refused this client.',
};

/** What the caller does after a message from the server. */
export interface Output {
  send: Packet[];
  /** The server refused us: stop, and show why. */
  refused?: string;
  /** Items received from other worlds since the first sync, to announce. */
  received: NetworkItem[];
}

export class Session {
  readonly credentials: Credentials;
  connected = false;
  seed = '';
  team = 0;
  slot = 0;
  /** Alias of each slot of our team. */
  players = new Map<number, string>();
  /** Game of each slot. */
  games = new Map<number, string>();
  /** Item and location names, by game then id. */
  itemNames = new Map<string, Map<number, string>>();
  locationNames = new Map<string, Map<number, string>>();
  checked = new Set<number>();
  locations = 0;
  hintPoints = 0;
  /** Percentage of a slot's locations a hint costs. */
  hintCost = 0;
  /** Received items, oldest first. */
  items: NetworkItem[] = [];
  hints: Hint[] = [];
  log: Line[] = [];
  private nextLine = 1;
  private namesSeed = '';

  constructor(credentials: Credentials) {
    this.credentials = credentials;
  }

  get hintsKey() {
    return `_read_hints_${this.team}_${this.slot}`;
  }

  /** Points a hint costs, 0 when hints are free. */
  get hintPrice() {
    return this.hintCost > 0 ? Math.max(1, Math.floor(this.hintCost * 0.01 * this.locations)) : 0;
  }

  /** The socket was opened again: the handshake starts over, the log stays. */
  reset() {
    this.connected = false;
  }

  /** Handles one WebSocket message. */
  receive(data: unknown): Output {
    const output: Output = { send: [], received: [] };
    for (const packet of decode(data)) this.handle(packet, output);
    return output;
  }

  private handle(packet: Packet, output: Output) {
    switch (packet.cmd) {
      case 'RoomInfo': {
        this.seed = str(packet.seed_name);
        this.hintCost = int(packet.hint_cost);
        if (this.namesSeed === this.seed) {
          output.send.push(this.connect());
        } else {
          const games = new Set([...list(packet.games).map((game) => str(game)), ARCHIPELAGO]);
          output.send.push({ cmd: 'GetDataPackage', games: [...games] });
        }
        break;
      }
      case 'DataPackage':
        this.loadNames(record(record(packet.data).games));
        this.namesSeed = this.seed;
        output.send.push(this.connect());
        break;
      case 'ConnectionRefused': {
        const errors = list(packet.errors).map((error) => str(error));
        output.refused =
          errors.map((error) => REFUSALS[error]).find(Boolean) ?? 'The room refused to connect.';
        break;
      }
      case 'Connected':
        this.connected = true;
        this.team = int(packet.team);
        this.slot = int(packet.slot);
        this.readPlayers(packet.players);
        this.games.clear();
        for (const [slot, info] of Object.entries(record(packet.slot_info))) {
          this.games.set(Number(slot), str(record(info).game));
        }
        this.checked = new Set(ints(packet.checked_locations));
        this.locations = this.checked.size + ints(packet.missing_locations).length;
        this.hintPoints = int(packet.hint_points);
        this.items = [];
        this.hints = [];
        output.send.push(
          { cmd: 'Get', keys: [this.hintsKey] },
          { cmd: 'SetNotify', keys: [this.hintsKey] },
        );
        break;
      case 'RoomUpdate':
        if ('players' in packet) this.readPlayers(packet.players);
        if ('hint_points' in packet) this.hintPoints = int(packet.hint_points);
        if ('hint_cost' in packet) this.hintCost = int(packet.hint_cost);
        for (const location of ints(packet.checked_locations)) this.checked.add(location);
        break;
      case 'ReceivedItems': {
        const index = int(packet.index);
        const items = list(packet.items).map(networkItem);
        if (index === 0) {
          // The whole inventory, sent on connection: nothing new to announce.
          this.items = items;
        } else {
          this.items = [...this.items.slice(0, index), ...items];
          output.received.push(...items.filter((item) => item.player !== this.slot));
        }
        break;
      }
      case 'Retrieved':
        if (this.hintsKey in record(packet.keys)) {
          this.hints = list(record(packet.keys)[this.hintsKey]).map(hint);
        }
        break;
      case 'SetReply':
        if (packet.key === this.hintsKey) this.hints = list(packet.value).map(hint);
        break;
      case 'PrintJSON':
        this.addLine(
          str(packet.type, 'Text'),
          list(packet.data).map((part) => this.resolve(messagePart(part))),
        );
        break;
      case 'InvalidPacket':
        this.note(`The server rejected a message: ${str(packet.text)}`);
        break;
    }
  }

  private connect(): Packet {
    return {
      cmd: 'Connect',
      game: '',
      name: this.credentials.name,
      password: this.credentials.password,
      uuid: this.credentials.uuid,
      version: VERSION,
      items_handling: 0b111,
      tags: ['TextOnly'],
      slot_data: false,
    };
  }

  private readPlayers(players: unknown) {
    this.players.clear();
    for (const value of list(players)) {
      const player = record(value);
      if (int(player.team, -1) === this.team) {
        this.players.set(int(player.slot), str(player.alias) || str(player.name));
      }
    }
  }

  private loadNames(games: Record<string, unknown>) {
    const reverse = (names: unknown) =>
      new Map(
        Object.entries(record(names)).flatMap(([name, id]) =>
          Number.isSafeInteger(id) ? [[id as number, name] as const] : [],
        ),
      );
    for (const [game, data] of Object.entries(games)) {
      this.itemNames.set(game, reverse(record(data).item_name_to_id));
      this.locationNames.set(game, reverse(record(data).location_name_to_id));
    }
  }

  playerName(slot: number): string {
    if (slot === 0) return ARCHIPELAGO;
    return this.players.get(slot) ?? `Player ${slot}`;
  }

  /** An item's name, in the game of the world it belongs to. */
  itemName(id: number, owner: number): string {
    return this.lookup(this.itemNames, id, owner) ?? `Unknown item ${id}`;
  }

  /** A location's name, in the game of the world it is in. */
  locationName(id: number, world: number): string {
    return this.lookup(this.locationNames, id, world) ?? `Unknown location ${id}`;
  }

  private lookup(names: Map<string, Map<number, string>>, id: number, slot: number) {
    // Ids ≤ 0 belong to Archipelago itself (`Server`, `Cheat Console`…) in every game.
    const game = this.games.get(slot) ?? ARCHIPELAGO;
    return names.get(game)?.get(id) ?? names.get(ARCHIPELAGO)?.get(id);
  }

  private resolve(part: MessagePart): Part {
    const text = part.text ?? '';
    const id = Number(text);
    switch (part.type) {
      case 'player_id':
        return { text: this.playerName(id), kind: id === this.slot ? 'self' : 'player' };
      case 'player_name':
        return { text, kind: 'player' };
      case 'item_id':
        return {
          text: this.itemName(id, part.player ?? 0),
          kind: 'item',
          flags: part.flags ?? 0,
        };
      case 'item_name':
        return { text, kind: 'item', flags: part.flags ?? 0 };
      case 'location_id':
        return { text: this.locationName(id, part.player ?? 0), kind: 'location' };
      case 'location_name':
        return { text, kind: 'location' };
      case 'entrance_name':
        return { text, kind: 'entrance' };
      case 'hint_status':
        return { text: HINT_STATUS[part.hint_status ?? -1] ?? text, kind: 'status' };
      case 'color':
        return part.color ? { text, kind: 'color', color: part.color } : { text, kind: 'text' };
      default:
        return { text, kind: 'text' };
    }
  }

  private addLine(type: string, parts: Part[]) {
    this.log.push({ id: this.nextLine++, type, parts });
    if (this.log.length > LOG_SIZE) this.log.splice(0, this.log.length - LOG_SIZE);
  }

  /** A line of our own in the log. */
  note(text: string) {
    this.addLine('Note', [{ text, kind: 'text' }]);
  }

  /** Notification for items received from other worlds (within the SDK's 80/300 characters). */
  announce(items: NetworkItem[]): { title: string; body: string } {
    const clip = (text: string, max: number) =>
      text.length > max ? `${text.slice(0, max - 1)}…` : text;
    const first = items[0];
    if (items.length === 1 && first) {
      const from = this.locationName(first.location, first.player);
      return {
        title: clip(this.itemName(first.item, this.slot), 80),
        body: clip(`From ${this.playerName(first.player)} (${from})`, 300),
      };
    }
    // Progression first: that is what the player waits for.
    const sorted = [...items].sort((a, b) => (b.flags & PROGRESSION) - (a.flags & PROGRESSION));
    const names = sorted.slice(0, 3).map((item) => this.itemName(item.item, this.slot));
    const more = items.length - names.length;
    return {
      title: `${items.length} items received`,
      body: clip(more > 0 ? `${names.join(', ')} and ${more} more` : names.join(', '), 300),
    };
  }
}
