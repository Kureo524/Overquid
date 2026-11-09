/**
 * Overquid plugin SDK.
 *
 * ```ts
 * import { connect } from '@overquid/sdk';
 *
 * const overquid = connect();
 * overquid.onShow(() => refresh());
 * await overquid.storage.set('draft', text);
 * ```
 */

export const SDK_VERSION = '0.1.0';

export {
  connect,
  createClient,
  OverquidError,
  type Json,
  type OverquidClient,
  type Storage,
  type Transport,
  type Unsubscribe,
} from './client';
export {
  PROTOCOL,
  isCall,
  isEvent,
  isReply,
  type CallMessage,
  type EventMessage,
  type ReplyMessage,
} from './protocol';

/** Permissions a plugin can request in its manifest. */
export type Permission = 'storage' | 'hotkeys' | 'notifications' | 'context' | 'events';

/** Shape of a plugin's `manifest.json`. */
export interface PluginManifest {
  /** Reverse-DNS identifier, e.g. `com.example.notes`. Also the plugin folder's name. */
  id: string;
  name: string;
  version: string;
  /** Entry HTML file, relative to the plugin folder. */
  entry: string;
  panel?: {
    defaultSize?: [width: number, height: number];
  };
  permissions?: Permission[];
  /** Host names the plugin may reach with `fetch`, e.g. `api.example.com`. */
  network?: string[];
}
