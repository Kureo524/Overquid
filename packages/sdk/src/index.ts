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

export const SDK_VERSION = '0.2.0'; // x-release-please-version

export {
  connect,
  createClient,
  OverquidError,
  type Apps,
  type DockRect,
  type FileEntry,
  type Files,
  type FolderListing,
  type Json,
  type LaunchOptions,
  type Notification,
  type SpaceNode,
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
export type Permission = 'storage' | 'hotkeys' | 'notifications' | 'context' | 'events' | 'files';

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
  /**
   * Hosts the plugin may reach with `fetch` (`https`) and `WebSocket` (`wss`):
   * `api.example.com`, `example.com:8443`, or `archipelago.gg:*` for any port.
   */
  network?: string[];
  /** Desktop entries of the applications the plugin may start, such as `com.obsproject.Studio`. */
  apps?: string[];
}
