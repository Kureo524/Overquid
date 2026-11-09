import { PROTOCOL, isEvent, isReply, type CallMessage } from './protocol';

/** How the client reaches the host. `connect()` uses `window.parent`. */
export interface Transport {
  post(message: CallMessage): void;
  /** Registers the handler for messages coming from the host. */
  listen(handler: (data: unknown) => void): void;
}

export type Unsubscribe = () => void;

/** JSON-serialisable value, as stored by `storage`. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface Storage {
  get<T extends Json = Json>(key: string): Promise<T | undefined>;
  set(key: string, value: Json): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export interface Notification {
  /** Shown after the plugin's name, which the core always puts first. 80 characters at most. */
  title: string;
  /** 300 characters at most. */
  body?: string;
}

export interface OverquidClient {
  /** Called each time the plugin's panel becomes visible. */
  onShow(callback: () => void): Unsubscribe;
  /** Called each time the plugin's panel is hidden. Pause timers and media here. */
  onHide(callback: () => void): Unsubscribe;
  /** Whether the panel is visible right now. */
  readonly visible: boolean;
  /** Data of this plugin, kept by the core. Needs the `storage` permission. */
  storage: Storage;
  /**
   * Shows a desktop notification. Needs the `notifications` permission; at
   * most 5 per minute.
   */
  notify(notification: Notification): Promise<void>;
  /** Raw call to a core method. Prefer the typed helpers. */
  call<T = unknown>(method: string, args?: unknown): Promise<T>;
}

export class OverquidError extends Error {
  override name = 'OverquidError';
}

export function createClient(transport: Transport): OverquidClient {
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const listeners = { show: new Set<() => void>(), hide: new Set<() => void>() };
  let visible = false;

  transport.listen((data) => {
    if (isEvent(data)) {
      visible = data.event === 'show';
      for (const callback of listeners[data.event]) callback();
      return;
    }
    if (isReply(data)) {
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      if (data.error !== undefined) request.reject(new OverquidError(data.error));
      else request.resolve(data.result);
    }
  });

  const call = <T>(method: string, args?: unknown) =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      transport.post({ overquid: PROTOCOL, id, method, args });
    });

  const subscribe = (event: 'show' | 'hide', callback: () => void): Unsubscribe => {
    listeners[event].add(callback);
    return () => listeners[event].delete(callback);
  };

  return {
    onShow: (callback) => subscribe('show', callback),
    onHide: (callback) => subscribe('hide', callback),
    get visible() {
      return visible;
    },
    call,
    notify: async ({ title, body }) => {
      await call('notify', { title, body });
    },
    storage: {
      get: async <T extends Json>(key: string) => {
        const value = await call<T | null>('storage.get', { key });
        return value ?? undefined;
      },
      set: async (key, value) => {
        await call('storage.set', { key, value });
      },
      remove: async (key) => {
        await call('storage.remove', { key });
      },
      keys: () => call<string[]>('storage.keys'),
    },
  };
}

let client: OverquidClient | undefined;

/** The client of this plugin, talking to the overlay that embeds it. */
export function connect(): OverquidClient {
  client ??= createClient({
    post: (message) => window.parent.postMessage(message, '*'),
    listen: (handler) =>
      window.addEventListener('message', (event) => {
        // Only the overlay that embeds the plugin may talk to it.
        if (event.source === window.parent) handler(event.data);
      }),
  });
  return client;
}
