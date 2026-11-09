import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { PROTOCOL, isCall, type EventMessage, type ReplyMessage } from '@overquid/sdk';

/** What `list_plugins` returns for each installed plugin. */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  entry: string;
  panel: {
    defaultSize?: [number, number] | null;
    position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' | null;
  };
  permissions: string[];
  network: string[];
}

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
 * The broker (ADR 0003). Plugin iframes are sandboxed (opaque origin): the
 * only thing that identifies a sender is the window the message comes from,
 * which a plugin cannot forge. Messages from any other window are ignored, and
 * nothing a plugin puts in its payload is used to identify it.
 */
const frames = new Map<MessageEventSource, string>();

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
