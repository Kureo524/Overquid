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

export interface FileEntry {
  name: string;
  dir: boolean;
  /** A symbolic link; `dir` and `size` describe what it points to. */
  link: boolean;
  size: number;
  /** Seconds since 1970. */
  modified: number | null;
}

export interface FolderListing {
  path: string;
  parent: string | null;
  entries: FileEntry[];
}

export interface SpaceNode {
  name: string;
  size: number;
  dir: boolean;
  /** The largest ones only; `size` counts everything. */
  children: SpaceNode[];
}

export interface LaunchOptions {
  /** Added after the application's own command. */
  args?: string[];
  /** Hyprland workspace to start on, without going there (`3`, `special:obs`). Ignored elsewhere. */
  workspace?: string;
}

/** The applications listed in the manifest's `apps`, named by desktop entry. */
export interface Apps {
  installed(app: string): Promise<boolean>;
  launch(app: string, options?: LaunchOptions): Promise<void>;
}

/**
 * The user's files. Needs the `files` permission. Plugins see names, sizes and
 * dates, never what is in a file, and can only delete by moving to the trash.
 */
export interface Files {
  home(): Promise<string>;
  list(path: string): Promise<FolderListing>;
  /** Opens with the user's default application. */
  open(path: string): Promise<void>;
  rename(path: string, name: string): Promise<void>;
  mkdir(path: string, name: string): Promise<void>;
  trash(path: string): Promise<void>;
  /** What takes up space under `path`. Can take a while on a large disk. */
  scan(path: string): Promise<SpaceNode>;
}

export interface OverquidClient {
  /** Called each time the plugin's panel becomes visible. */
  onShow(callback: () => void): Unsubscribe;
  /** Called each time the plugin's panel is hidden. Pause timers and media here. */
  onHide(callback: () => void): Unsubscribe;
  /**
   * Called with the overlay's colours, as CSS custom properties (`--accent`,
   * `--surface`…), now if they are known and on every change. `connect()`
   * already applies them to the page: use `var(--accent, #8fa4cc)` in your CSS.
   */
  onTheme(callback: (tokens: Record<string, string>) => void): Unsubscribe;
  /** Whether the panel is visible right now. */
  readonly visible: boolean;
  /** Data of this plugin, kept by the core. Needs the `storage` permission. */
  storage: Storage;
  /**
   * Shows a desktop notification. Needs the `notifications` permission; at
   * most 5 per minute.
   */
  notify(notification: Notification): Promise<void>;
  /** The user's files. Needs the `files` permission. */
  files: Files;
  /** The applications listed in the manifest's `apps`. */
  apps: Apps;
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
  const themeListeners = new Set<(tokens: Record<string, string>) => void>();
  let theme: Record<string, string> | undefined;
  let visible = false;

  transport.listen((data) => {
    if (isEvent(data)) {
      if (data.event === 'theme') {
        theme = data.tokens;
        for (const callback of themeListeners) callback(data.tokens);
        return;
      }
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
    onTheme: (callback) => {
      themeListeners.add(callback);
      if (theme) callback(theme);
      return () => themeListeners.delete(callback);
    },
    get visible() {
      return visible;
    },
    call,
    notify: async ({ title, body }) => {
      await call('notify', { title, body });
    },
    files: {
      home: () => call<string>('files.home'),
      list: (path) => call<FolderListing>('files.list', { path }),
      open: async (path) => {
        await call('files.open', { path });
      },
      rename: async (path, name) => {
        await call('files.rename', { path, name });
      },
      mkdir: async (path, name) => {
        await call('files.mkdir', { path, name });
      },
      trash: async (path) => {
        await call('files.trash', { path });
      },
      scan: (path) => call<SpaceNode>('files.scan', { path }),
    },
    apps: {
      installed: (app) => call<boolean>('apps.installed', { app }),
      launch: async (app, options = {}) => {
        await call('apps.launch', { app, ...options });
      },
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
  if (client) return client;
  client = createClient({
    post: (message) => window.parent.postMessage(message, '*'),
    listen: (handler) =>
      window.addEventListener('message', (event) => {
        // Only the overlay that embeds the plugin may talk to it.
        if (event.source === window.parent) handler(event.data);
      }),
  });
  client.onTheme((tokens) => {
    for (const [name, value] of Object.entries(tokens)) {
      document.documentElement.style.setProperty(name, value);
    }
  });
  return client;
}
