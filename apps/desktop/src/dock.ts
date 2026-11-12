import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { holesAbove, layoutRect, onGeometryChange } from './geometry';
import type { Rect, Visibility } from './overlay';

/**
 * Windows of other applications shown through the overlay (ADR 0014). A plugin
 * gives an area of its panel; the core puts the application's window under the
 * overlay at that place, and everything the overlay draws there is cut out so
 * that the window shows and takes the clicks. Panels in front still cover it.
 */
interface Message {
  pluginId: string;
  appId: string;
  /** In the overlay's page; `null` sends the window away. */
  rect: Rect | null;
  covers: Rect[];
  workspace: string | undefined;
}

interface Dock {
  pluginId: string;
  app: string;
  /** In the plugin's own page. */
  rect: Rect;
  workspace?: string | undefined;
  /** What the core should be told, and what it was last told. */
  wanted: Message | null;
  sent: string;
  /** One call at a time: a panel being dragged only needs its last place. */
  busy: boolean;
  again: boolean;
  /** Ask the core to look for the application's other windows again. */
  refresh: boolean;
  /** Those windows (dialogs, a screen picker), in the overlay's page. */
  extras: Rect[];
}

const docks = new Map<Window, Dock>();
let visibility: Visibility | null = null;
let started = false;

/** How often the application's other windows are looked for, while one is shown. */
const REFRESH_EVERY = 400;

const isRect = (value: unknown): value is Rect =>
  typeof value === 'object' &&
  value !== null &&
  (['x', 'y', 'width', 'height'] as const).every((key) =>
    Number.isFinite((value as Record<string, unknown>)[key]),
  );

const frameOf = (frame: Window) =>
  [...document.querySelectorAll('iframe')].find((element) => element.contentWindow === frame);

const sameRect = (a: Rect, b: Rect) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** `clip-path` keeping all of an element but `holes` (in the page's pixels). */
export function clipAround(own: Rect, holes: Rect[]): string {
  const far = 100_000;
  const cuts = holes.map((hole) => {
    const left = hole.x - own.x;
    const top = hole.y - own.y;
    return `M${left} ${top}h${hole.width}v${hole.height}h${-hole.width}Z`;
  });
  return `path(evenodd, "M${-far} ${-far}H${far}V${far}H${-far}Z${cuts.join('')}")`;
}

interface Hole {
  rect: Rect;
  /** The panels in front: they are not cut, and cover the window. */
  covers: Rect[];
}

let veil: HTMLElement | null = null;

/** Cuts `holes` out of what the overlay draws behind them. */
function cut(holes: Hole[]) {
  document.querySelectorAll<HTMLElement>('[data-docked]').forEach((element) => {
    element.style.clipPath = '';
    delete element.dataset.docked;
  });
  const stage = document.querySelector<HTMLElement>('.stage');
  if (holes.length === 0 || !stage) {
    veil?.remove();
    veil = null;
    if (stage) delete stage.dataset.docked;
    return;
  }
  document.querySelectorAll<HTMLElement>('[data-layer]').forEach((element) => {
    const own = layoutRect(element);
    const behind = holes
      .filter((hole) => !hole.covers.some((cover) => sameRect(cover, own)))
      .map((hole) => hole.rect);
    if (behind.length === 0) return;
    element.style.clipPath = clipAround(own, behind);
    element.dataset.docked = 'true';
  });
  // The dimming of the summoned overlay is the stage's background: it moves to
  // an element of its own, which can be cut without cutting the panels.
  stage.dataset.docked = 'true';
  if (!veil) {
    veil = document.createElement('div');
    veil.className = 'dock-veil';
    document.body.append(veil);
  }
  veil.hidden = visibility !== 'summoned';
  veil.style.clipPath = clipAround(
    layoutRect(veil),
    holes.map((hole) => hole.rect),
  );
}

/** Tells the core where a window goes; calls made meanwhile collapse into one. */
function push(frame: Window, dock: Dock) {
  const message = dock.wanted;
  if (!message) return;
  if (dock.busy) {
    dock.again = true;
    return;
  }
  dock.busy = true;
  const refresh = dock.refresh;
  dock.refresh = false;
  dock.sent = JSON.stringify(message);
  invoke<[number, number, number, number][]>('dock_window', { ...message, refresh })
    .then((extras) => {
      const next = extras.map(([x, y, width, height]) => ({ x, y, width, height }));
      const changed =
        next.length !== dock.extras.length ||
        next.some((rect, index) => {
          const known = dock.extras[index];
          return !known || !sameRect(rect, known);
        });
      dock.extras = next;
      if (changed) dock.again = true;
    })
    .catch((error: unknown) => {
      console.error('Cannot place the window:', error);
      // Nothing under the hole: close it.
      if (docks.get(frame) === dock && message.rect) {
        docks.delete(frame);
        dock.again = true;
      }
    })
    .finally(() => {
      dock.busy = false;
      if (dock.again) {
        dock.again = false;
        sync();
      }
    });
}

function sync() {
  const holes: Hole[] = [];
  for (const [frame, dock] of docks) {
    const element = frameOf(frame);
    const panel = element?.closest<HTMLElement>('[data-layer]');
    const shown =
      element && panel && visibility !== 'hidden' && visibility !== null
        ? panel.dataset.hidden === 'false'
        : false;
    let rect: Rect | null = null;
    let covers: Rect[] = [];
    if (shown && element) {
      const origin = layoutRect(element);
      rect = {
        x: Math.round(origin.x + dock.rect.x),
        y: Math.round(origin.y + dock.rect.y),
        width: Math.round(dock.rect.width),
        height: Math.round(dock.rect.height),
      };
      covers = holesAbove(element).map(({ x, y, width, height }) => ({ x, y, width, height }));
      holes.push({ rect, covers });
      // Its dialogs are in front of everything.
      for (const extra of dock.extras) holes.push({ rect: extra, covers: [] });
    } else {
      dock.extras = [];
    }
    dock.wanted = {
      pluginId: dock.pluginId,
      appId: dock.app,
      rect,
      covers,
      workspace: dock.workspace,
    };
    if (JSON.stringify(dock.wanted) !== dock.sent || (dock.refresh && rect)) push(frame, dock);
  }
  cut(holes);
}

function start() {
  if (started) return;
  started = true;
  onGeometryChange(sync);
  window.addEventListener('resize', sync);
  void listen<Visibility>('overlay-state', (event) => {
    visibility = event.payload;
    sync();
  });
  void invoke<{ visibility: Visibility }>('overlay_status').then((status) => {
    visibility ??= status.visibility;
    sync();
  });
  setInterval(() => {
    let shown = false;
    for (const dock of docks.values()) {
      if (!dock.wanted?.rect) continue;
      dock.refresh = true;
      shown = true;
    }
    if (shown) sync();
  }, REFRESH_EVERY);
}

/** `apps.dock` from a plugin: show the application's window at `rect` of its page, or stop. */
export async function requestDock(frame: Window, pluginId: string, args: unknown): Promise<null> {
  const { app, rect, workspace } = (args ?? {}) as Record<string, unknown>;
  if (typeof app !== 'string') throw new Error("'app' must be a string");
  if (workspace !== undefined && typeof workspace !== 'string') {
    throw new Error("'workspace' must be a string");
  }
  start();
  if (rect === null || rect === undefined) {
    docks.delete(frame);
    await invoke('dock_window', {
      pluginId,
      appId: app,
      rect: null,
      covers: [],
      workspace,
      refresh: false,
    });
    sync();
    return null;
  }
  if (!isRect(rect) || rect.width < 1 || rect.height < 1)
    throw new Error("'rect' is not a rectangle");
  // Checked by the core before the overlay opens a hole for it.
  const known = docks.get(frame);
  if (known && known.pluginId === pluginId && known.app === app) {
    // The same window in a new place: keep what is known about it.
    known.rect = rect;
    known.workspace = workspace;
  } else {
    docks.set(frame, {
      pluginId,
      app,
      rect,
      workspace,
      wanted: null,
      sent: '',
      busy: false,
      again: false,
      refresh: false,
      extras: [],
    });
  }
  sync();
  return null;
}

/** A plugin's page is gone: its window leaves with it. */
export function releaseDock(frame: Window) {
  const dock = docks.get(frame);
  if (!dock) return;
  docks.delete(frame);
  invoke('dock_window', {
    pluginId: dock.pluginId,
    appId: dock.app,
    rect: null,
    covers: [],
    workspace: dock.workspace,
    refresh: false,
  }).catch(() => undefined);
  sync();
}
