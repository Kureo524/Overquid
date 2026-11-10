import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { PROTOCOL, isCall, type EventMessage, type ReplyMessage } from '@overquid/sdk';

/** What `list_plugins` returns for each installed plugin. */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  /** One line about the plugin. */
  description?: string;
  /** Iframe plugin: its entry file. Exactly one of `entry` and `web`. */
  entry?: string;
  /** Web panel: an official web app shown in a native view (ADR 0004). */
  web?: {
    url: string;
    hosts: string[];
    pauseOnHide: boolean;
    /** A browser: any site, with an address bar. */
    browser?: { search: string };
  };
  panel: {
    defaultSize?: [number, number] | null;
    position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' | null;
    /** Several panels of this plugin may be open at once (ADR 0007). */
    multiple?: boolean;
  };
  permissions: string[];
  network: string[];
}

/** A plugin on this machine. */
export interface InstalledPlugin extends PluginManifest {
  /** Installed by the user; plugins shipped with the app cannot be removed. */
  removable: boolean;
}

export const listPlugins = () => invoke<InstalledPlugin[]>('list_plugins');

/** A plugin offered by the official catalog (ADR 0009). */
export interface CatalogEntry {
  manifest: PluginManifest;
}

export const fetchCatalog = () => invoke<CatalogEntry[]>('plugin_catalog');
export const installPlugin = (id: string) => invoke('install_plugin', { id });
export const uninstallPlugin = (id: string) => invoke('uninstall_plugin', { id });

/** Whether version `a` is newer than `b` (dotted numbers, the rest ignored). */
export function isNewer(a: string, b: string): boolean {
  const parts = (version: string) =>
    version.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const [left, right] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

/** URL of a plugin file. Built from Tauri's helper so it follows the platform
 * (`overquid-plugin://localhost/` on Linux, `http://overquid-plugin.localhost/`
 * on Windows), but with real slashes so relative URLs work in the plugin. */
export function pluginUrl(id: string, path: string): string {
  const base = convertFileSrc('', 'overquid-plugin');
  const segments = [id, ...path.split('/')].map(encodeURIComponent);
  return base + segments.join('/');
}

/**
 * The broker (ADR 0003). Plugin iframes are sandboxed (opaque origin): the
 * only thing that identifies a sender is the window the message comes from,
 * which a plugin cannot forge. Messages from any other window are ignored, and
 * nothing a plugin puts in its payload is used to identify it.
 */
const frames = new Map<MessageEventSource, string>();
let theme: Record<string, string> = {};

// The iframe's origin is opaque ("null"): '*' is the only possible target,
// and every message goes to one exact window.
const send = (frame: Window, message: ReplyMessage | EventMessage) =>
  frame.postMessage(message, '*');

export function registerFrame(frame: Window, pluginId: string): () => void {
  frames.set(frame, pluginId);
  return () => frames.delete(frame);
}

/** Tells a plugin whether its panel is on screen. */
export function sendVisibility(frame: Window, visible: boolean) {
  send(frame, { overquid: PROTOCOL, event: visible ? 'show' : 'hide' });
}

/** Tells a plugin the overlay's colours; the SDK applies them to its page. */
export function sendTheme(frame: Window) {
  send(frame, { overquid: PROTOCOL, event: 'theme', tokens: theme });
}

/** Applies new colours to every plugin. */
export function broadcastTheme(tokens: Record<string, string>) {
  theme = tokens;
  for (const frame of frames.keys()) sendTheme(frame as Window);
}

export function startBroker(): () => void {
  const onMessage = (event: MessageEvent) => {
    const source = event.source as Window | null;
    const pluginId = source ? frames.get(source) : undefined;
    if (!source || !pluginId || !isCall(event.data)) return;
    const { id, method, args } = event.data;
    invoke('plugin_call', { pluginId, method, args: args ?? null }).then(
      (result) => send(source, { overquid: PROTOCOL, id, result }),
      (error: unknown) => send(source, { overquid: PROTOCOL, id, error: String(error) }),
    );
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}
