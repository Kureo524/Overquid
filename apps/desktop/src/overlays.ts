import { invoke } from '@tauri-apps/api/core';
import { migrateLayout, parseLayout, type Layout, type PanelLayout } from './layout';

/**
 * Several overlays (ADR 0006): each one is a named layout, the panels it shows
 * and where. One instance of each plugin is shared between overlays.
 */
export interface Overlay {
  id: string;
  name: string;
  /** The panels of this overlay, by panel id: a panel is in it if it has an entry. */
  panels: Layout;
  /** Window classes of the apps that bring this overlay forward when they get the focus. */
  apps?: string[];
}

export interface Overlays {
  active: string;
  overlays: Overlay[];
}

export const OVERLAYS_VERSION = 2;

/** What `parseOverlays` read: `migrated` when it came from a one-overlay layout. */
export interface Loaded {
  overlays: Overlays;
  /** Panels to add with their default layout: everything installed, on first run or migration. */
  fillWithInstalled: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const MAIN: Overlay = { id: 'main', name: 'Main', panels: {} };

/** Reads `layout.json`: version 2 as is, version 1 (one layout) as the Main overlay. */
export function parseOverlays(value: unknown): Loaded {
  if (isRecord(value) && value.version === OVERLAYS_VERSION && Array.isArray(value.overlays)) {
    const overlays: Overlay[] = [];
    const ids = new Set<string>();
    for (const entry of value.overlays) {
      if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.name !== 'string') {
        continue;
      }
      if (!entry.id || ids.has(entry.id)) continue;
      ids.add(entry.id);
      const panels = parseLayout({ version: 1, panels: entry.panels });
      const overlay: Overlay = { id: entry.id, name: entry.name.trim() || 'Overlay', panels };
      const apps = Array.isArray(entry.apps)
        ? entry.apps.filter((app): app is string => typeof app === 'string' && app.trim() !== '')
        : [];
      if (apps.length > 0) overlay.apps = apps;
      overlays.push(overlay);
    }
    if (overlays.length > 0) {
      const first = overlays[0] as Overlay;
      const active =
        typeof value.active === 'string' && ids.has(value.active) ? value.active : first.id;
      return { overlays: { active, overlays }, fillWithInstalled: false };
    }
  }
  // Version 1, nothing saved yet, or unreadable: one overlay with everything.
  const panels = migrateLayout(parseLayout(value));
  return {
    overlays: { active: MAIN.id, overlays: [{ ...MAIN, panels }] },
    fillWithInstalled: true,
  };
}

export const serializeOverlays = (overlays: Overlays) => ({
  version: OVERLAYS_VERSION,
  ...overlays,
});

export const loadOverlays = async (): Promise<Loaded> =>
  parseOverlays(await invoke<unknown>('load_layout'));

export const saveOverlays = (overlays: Overlays) =>
  invoke('save_layout', { layout: serializeOverlays(overlays) });

export function activeOverlay(state: Overlays): Overlay {
  return (state.overlays.find((overlay) => overlay.id === state.active) ??
    state.overlays[0]) as Overlay;
}

/** Replaces the active overlay's panels. */
function withPanels(state: Overlays, panels: (current: Layout) => Layout): Overlays {
  const active = activeOverlay(state);
  return {
    ...state,
    overlays: state.overlays.map((overlay) =>
      overlay.id === active.id ? { ...overlay, panels: panels(overlay.panels) } : overlay,
    ),
  };
}

/** Changes one panel of the active overlay (added if it was not in it). */
export function updatePanel(
  state: Overlays,
  id: string,
  change: Partial<PanelLayout>,
  fallback: PanelLayout,
): Overlays {
  return withPanels(state, (panels) => ({
    ...panels,
    [id]: { ...(panels[id] ?? fallback), ...change },
  }));
}

export function addPanels(state: Overlays, panels: Layout): Overlays {
  return withPanels(state, (current) => ({ ...panels, ...current }));
}

export function removePanel(state: Overlays, id: string): Overlays {
  return withPanels(state, (panels) =>
    Object.fromEntries(Object.entries(panels).filter(([panel]) => panel !== id)),
  );
}

/** The overlay `step` places after (or before) the active one, wrapping around. */
export function cycle(state: Overlays, step: 1 | -1): Overlays {
  const index = state.overlays.findIndex((overlay) => overlay.id === state.active);
  const count = state.overlays.length;
  const next = state.overlays[(((index + step) % count) + count) % count] as Overlay;
  return { ...state, active: next.id };
}

/** Activates the overlay called `name` (case-insensitive); unchanged if there is none. */
export function switchByName(state: Overlays, name: string): Overlays {
  const wanted = name.trim().toLowerCase();
  const found = state.overlays.find((overlay) => overlay.name.trim().toLowerCase() === wanted);
  return found ? { ...state, active: found.id } : state;
}

/** A new, empty overlay, made active. Its name is unique: "Overlay 2", "Overlay 3"… */
export function createOverlay(state: Overlays): Overlays {
  const names = new Set(state.overlays.map((overlay) => overlay.name.toLowerCase()));
  let number = state.overlays.length + 1;
  while (names.has(`overlay ${number}`)) number += 1;
  let id = `overlay-${number}`;
  const ids = new Set(state.overlays.map((overlay) => overlay.id));
  for (let suffix = 2; ids.has(id); suffix += 1) id = `overlay-${number}-${suffix}`;
  return {
    active: id,
    overlays: [...state.overlays, { id, name: `Overlay ${number}`, panels: {} }],
  };
}

export function renameOverlay(state: Overlays, id: string, name: string): Overlays {
  const trimmed = name.trim();
  if (!trimmed) return state;
  return {
    ...state,
    overlays: state.overlays.map((overlay) =>
      overlay.id === id ? { ...overlay, name: trimmed } : overlay,
    ),
  };
}

/** Deletes an overlay, never the last one. Deleting the active one activates its neighbour. */
export function deleteOverlay(state: Overlays, id: string): Overlays {
  if (state.overlays.length <= 1) return state;
  const index = state.overlays.findIndex((overlay) => overlay.id === id);
  if (index < 0) return state;
  const overlays = state.overlays.filter((overlay) => overlay.id !== id);
  const neighbour = overlays[Math.min(index, overlays.length - 1)] as Overlay;
  return { active: state.active === id ? neighbour.id : state.active, overlays };
}

const sameApp = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The overlay bound to the app with window class `app`, if any. */
export function overlayForApp(state: Overlays, app: string): Overlay | undefined {
  return state.overlays.find((overlay) => overlay.apps?.some((known) => sameApp(known, app)));
}

/**
 * Binds `app` to overlay `id`, or unbinds it if it already was. An app brings
 * one overlay forward: binding it moves it from any other overlay.
 */
export function toggleApp(state: Overlays, id: string, app: string): Overlays {
  const bound = state.overlays
    .find((overlay) => overlay.id === id)
    ?.apps?.some((known) => sameApp(known, app));
  return {
    ...state,
    overlays: state.overlays.map((overlay) => {
      const others = (overlay.apps ?? []).filter((known) => !sameApp(known, app));
      const apps = overlay.id === id && !bound ? [...others, app] : others;
      const next: Overlay = { id: overlay.id, name: overlay.name, panels: overlay.panels };
      if (apps.length > 0) next.apps = apps;
      return next;
    }),
  };
}
