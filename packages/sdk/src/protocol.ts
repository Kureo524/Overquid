/**
 * Messages exchanged between a plugin (in its sandboxed iframe) and the
 * overlay host, over `postMessage`. Every message carries `overquid: 1` so
 * that unrelated messages are ignored on both sides.
 */

export const PROTOCOL = 1;

/** Plugin → host: call a core method. */
export interface CallMessage {
  overquid: typeof PROTOCOL;
  id: number;
  method: string;
  args?: unknown;
}

/** Host → plugin: answer to a call. */
export interface ReplyMessage {
  overquid: typeof PROTOCOL;
  id: number;
  result?: unknown;
  error?: string;
}

/** Host → plugin: something happened. */
export type EventMessage =
  | { overquid: typeof PROTOCOL; event: 'show' | 'hide' }
  /** The overlay's colours, as CSS custom properties (`--accent`, `--surface`…). */
  | { overquid: typeof PROTOCOL; event: 'theme'; tokens: Record<string, string> };

const isTagged = (data: unknown): data is Record<string, unknown> =>
  typeof data === 'object' &&
  data !== null &&
  (data as { overquid?: unknown }).overquid === PROTOCOL;

export const isCall = (data: unknown): data is CallMessage =>
  isTagged(data) && typeof data.id === 'number' && typeof data.method === 'string';

export const isReply = (data: unknown): data is ReplyMessage =>
  isTagged(data) && typeof data.id === 'number' && !('method' in data);

export const isEvent = (data: unknown): data is EventMessage =>
  isTagged(data) &&
  (data.event === 'show' ||
    data.event === 'hide' ||
    (data.event === 'theme' && typeof data.tokens === 'object' && data.tokens !== null));
