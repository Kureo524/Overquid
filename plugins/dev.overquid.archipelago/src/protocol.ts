/**
 * The parts of the Archipelago network protocol this plugin uses: JSON lists
 * of commands over a WebSocket.
 * https://github.com/ArchipelagoMW/Archipelago/blob/main/docs/network%20protocol.md
 *
 * Packets come from a server, not from us: every field is read defensively.
 */

/** Archipelago version we speak. A TextOnly client skips the game's version check. */
export const VERSION = { major: 0, minor: 6, build: 8, class: 'Version' } as const;

/** Item flags. */
export const PROGRESSION = 0b001;
export const USEFUL = 0b010;
export const TRAP = 0b100;

export interface NetworkItem {
  item: number;
  location: number;
  /** The world the item was found in (the receiver's slot in LocationInfo). */
  player: number;
  flags: number;
}

export interface Hint {
  receivingPlayer: number;
  findingPlayer: number;
  location: number;
  item: number;
  found: boolean;
  entrance: string;
  itemFlags: number;
  status: number;
}

export const HINT_STATUS: Record<number, string> = {
  0: 'Unspecified',
  10: 'No priority',
  20: 'Avoid',
  30: 'Priority',
  40: 'Found',
};

export interface MessagePart {
  type?: string;
  text?: string;
  color?: string;
  flags?: number;
  player?: number;
  hint_status?: number;
}

/** A server command: `cmd` plus its arguments, still unchecked. */
export type Packet = { cmd: string } & Record<string, unknown>;

/** The commands of one WebSocket message. Anything else is ignored. */
export function decode(data: unknown): Packet[] {
  if (typeof data !== 'string') return [];
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.filter(
    (packet): packet is Packet =>
      typeof packet === 'object' && packet !== null && typeof packet.cmd === 'string',
  );
}

export const int = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback;

export const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const ints = (value: unknown): number[] =>
  list(value).filter((n): n is number => Number.isSafeInteger(n));

export function networkItem(value: unknown): NetworkItem {
  const item = record(value);
  return {
    item: int(item.item),
    location: int(item.location),
    player: int(item.player),
    flags: int(item.flags),
  };
}

export function hint(value: unknown): Hint {
  const h = record(value);
  return {
    receivingPlayer: int(h.receiving_player),
    findingPlayer: int(h.finding_player),
    location: int(h.location),
    item: int(h.item),
    found: h.found === true,
    entrance: str(h.entrance),
    itemFlags: int(h.item_flags),
    status: int(h.status, h.found === true ? 40 : 0),
  };
}

export function messagePart(value: unknown): MessagePart {
  const part = record(value);
  const result: MessagePart = {};
  if (typeof part.type === 'string') result.type = part.type;
  if (typeof part.text === 'string') result.text = part.text;
  if (typeof part.color === 'string') result.color = part.color;
  if (Number.isSafeInteger(part.flags)) result.flags = part.flags as number;
  if (Number.isSafeInteger(part.player)) result.player = part.player as number;
  if (Number.isSafeInteger(part.hint_status)) result.hint_status = part.hint_status as number;
  return result;
}
