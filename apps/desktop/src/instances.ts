import type { Overlays } from './overlays';

/**
 * Several instances of a plugin (ADR 0007). A panel id is the plugin's id for
 * its first instance, then `plugin#2`, `plugin#3`…
 */

export const pluginOf = (panelId: string): string => panelId.split('#')[0] ?? panelId;

export function instanceOf(panelId: string): number {
  const number = Number(panelId.split('#')[1] ?? '1');
  return Number.isInteger(number) && number >= 1 ? number : 1;
}

export const panelIdOf = (pluginId: string, instance: number): string =>
  instance <= 1 ? pluginId : `${pluginId}#${instance}`;

/** The first free panel id of a plugin: its own id, or the lowest free `#n`. */
export function nextPanelId(pluginId: string, used: ReadonlySet<string>): string {
  let instance = 1;
  while (used.has(panelIdOf(pluginId, instance))) instance += 1;
  return panelIdOf(pluginId, instance);
}

/** "Browser", "Browser 2"… */
export const panelTitle = (name: string, panelId: string): string => {
  const instance = instanceOf(panelId);
  return instance > 1 ? `${name} ${instance}` : name;
};

/** Every panel id used by any overlay. */
export const panelIdsIn = (state: Overlays): Set<string> =>
  new Set(state.overlays.flatMap((overlay) => Object.keys(overlay.panels)));
