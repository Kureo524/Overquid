/** What the plugin keeps in its storage between sessions. */
export interface Settings {
  server: string;
  name: string;
  /** Room password, kept to reconnect without typing it again. */
  password: string;
  /** Notify items received while the overlay is hidden. */
  notify: boolean;
  /** Reconnect at start-up: the user was connected and did not disconnect. */
  rejoin: boolean;
  uuid: string;
}

export function parseSettings(value: unknown, newUuid: () => string): Settings {
  const stored =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const text = (key: string) => (typeof stored[key] === 'string' ? (stored[key] as string) : '');
  return {
    server: text('server'),
    name: text('name'),
    password: text('password'),
    notify: stored.notify !== false,
    rejoin: stored.rejoin === true,
    uuid: text('uuid') || newUuid(),
  };
}
