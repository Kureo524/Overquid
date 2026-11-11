/**
 * Room addresses. The plugin reaches archipelago.gg only (its manifest's
 * `network`), over secure WebSockets: each hosted room has its own port.
 */

export const HOST = 'archipelago.gg';
export const DEFAULT_PORT = 38281;

export type Address = { url: string } | { error: string };

/**
 * The `wss://` URL of a room, from what the user typed or pasted:
 * `archipelago.gg:38281`, `/connect archipelago.gg:38281`, a `wss://` or
 * `archipelago://` URL, or just the port.
 */
export function roomUrl(input: string): Address {
  let text = input
    .trim()
    .replace(/^\/connect\s+/i, '')
    .replace(/^(wss?|archipelago):\/\//i, '');
  if (text === '') return { error: 'Enter the server address shown on the room page.' };
  if (/^https?:\/\//i.test(text)) {
    return {
      error: `That is a web page: use the server address it shows, like ${HOST}:${DEFAULT_PORT}.`,
    };
  }
  if (/^\d+$/.test(text)) text = `${HOST}:${text}`;
  const match = /^([a-z0-9.-]+)(?::(\d+))?\/?$/i.exec(text);
  if (!match) return { error: `“${text}” is not a server address.` };
  const [, host = '', port = String(DEFAULT_PORT)] = match;
  if (host.toLowerCase() !== HOST) {
    return { error: `Only rooms hosted on ${HOST} are supported for now.` };
  }
  const number = Number(port);
  if (number < 1 || number > 65535) return { error: `${port} is not a port number.` };
  return { url: `wss://${HOST}:${number}` };
}
