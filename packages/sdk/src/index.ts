/**
 * Overquid plugin SDK.
 *
 * Phase 0 placeholder: the real API (lifecycle, storage, hotkeys…) lands in
 * phase 2. Only the manifest shape described in docs/PLAN.md is exposed here.
 */

export const SDK_VERSION = '0.0.0';

/** Permissions a plugin can request in its manifest. */
export type Permission = 'storage' | 'hotkeys' | 'notifications' | 'context' | 'events';

/** Shape of a plugin's `manifest.json`. */
export interface PluginManifest {
  /** Reverse-DNS identifier, e.g. `com.example.notes`. */
  id: string;
  name: string;
  version: string;
  /** Entry HTML file, relative to the plugin folder. */
  entry: string;
  panel?: {
    defaultSize?: [width: number, height: number];
    resizable?: boolean;
  };
  permissions?: Permission[];
  /** Domains the plugin is allowed to reach with `fetch`. */
  network?: string[];
}
