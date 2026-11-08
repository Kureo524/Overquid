import { convertFileSrc, invoke } from '@tauri-apps/api/core';

/** What `list_plugins` returns for each installed plugin. */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  entry: string;
  network: string[];
}

/** A call sent by a plugin's SDK through `postMessage`. */
interface PluginCall {
  id: number;
  method: string;
  args?: unknown;
}

const isCall = (data: unknown): data is PluginCall =>
  typeof data === 'object' &&
  data !== null &&
  typeof (data as PluginCall).id === 'number' &&
  typeof (data as PluginCall).method === 'string';

export const listPlugins = () => invoke<PluginManifest[]>('list_plugins');

/** URL of a plugin file. Built from Tauri's helper so it follows the platform
 * (`overquid-plugin://localhost/` on Linux, `http://overquid-plugin.localhost/`
 * on Windows), but with real slashes so relative URLs work in the plugin. */
export function pluginUrl(id: string, path: string): string {
  const base = convertFileSrc('', 'overquid-plugin');
  const segments = [id, ...path.split('/')].map(encodeURIComponent);
  return base + segments.join('/');
}

/**
 * The broker. Plugin iframes are sandboxed (opaque origin): the only thing
 * that identifies a sender is the window the message comes from, which a
 * plugin cannot forge. Messages from any other window are ignored, and any id
 * a plugin puts in its payload is never trusted.
 */
const frames = new Map<MessageEventSource, string>();

export function registerFrame(frame: Window, pluginId: string): () => void {
  frames.set(frame, pluginId);
  return () => frames.delete(frame);
}

export function startBroker(): () => void {
  const onMessage = (event: MessageEvent) => {
    const source = event.source;
    const pluginId = source ? frames.get(source) : undefined;
    if (!source || !pluginId || !isCall(event.data)) return;
    const { id, method, args } = event.data;
    const reply = (message: object) =>
      // The iframe's origin is opaque ("null"): '*' is the only possible
      // target, and the reply goes to that exact window.
      (source as Window).postMessage({ id, ...message }, '*');
    invoke('plugin_call', { pluginId, method, args: args ?? null }).then(
      (result) => reply({ result }),
      (error: unknown) => reply({ error: String(error) }),
    );
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}
