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
interface Dock {
  pluginId: string;
  app: string;
  /** In the plugin's own page. */
  rect: Rect;
  workspace?: string | undefined;
  /** What the core was last told, to tell it only about changes. */
  sent: string;
}

const docks = new Map<Window, Dock>();
let visibility: Visibility | null = null;
let started = false;

const isRect = (value: unknown): value is Rect =>
  typeof value === 'object' &&
  value !== null &&
  (['x', 'y', 'width', 'height'] as const).every((key) =>
    Number.isFinite((value as Record<string, unknown>)[key]),
  );

const frameOf = (frame: Window) =>
  [...document.querySelectorAll('iframe')].find((element) => element.contentWindow === frame);

/** `clip-path` keeping all of an element but `hole` (in the page's pixels). */
function clipAround(element: HTMLElement, hole: Rect): string {
  const own = layoutRect(element);
  const left = hole.x - own.x;
  const top = hole.y - own.y;
  const right = left + hole.width;
  const bottom = top + hole.height;
  const far = 100_000;
  return (
    `polygon(evenodd, ${-far}px ${-far}px, ${far}px ${-far}px, ${far}px ${far}px, ${-far}px ${far}px, ${-far}px ${-far}px, ` +
    `${left}px ${top}px, ${left}px ${bottom}px, ${right}px ${bottom}px, ${right}px ${top}px, ${left}px ${top}px)`
  );
}

let veil: HTMLElement | null = null;

/** Cuts `holes` out of what the overlay draws behind them. */
function cut(holes: { panel: HTMLElement; rect: Rect; covers: Rect[] }[]) {
  document.querySelectorAll<HTMLElement>('[data-docked]').forEach((element) => {
    element.style.clipPath = '';
    delete element.dataset.docked;
  });
  const stage = document.querySelector<HTMLElement>('.stage');
  const hole = holes[0];
  if (!hole || !stage) {
    veil?.remove();
    veil = null;
    if (stage) delete stage.dataset.docked;
    return;
  }
  const inFront = new Set(
    hole.covers.map((cover) => `${cover.x},${cover.y},${cover.width},${cover.height}`),
  );
  document.querySelectorAll<HTMLElement>('[data-layer]').forEach((element) => {
    const own = layoutRect(element);
    if (inFront.has(`${own.x},${own.y},${own.width},${own.height}`)) return;
    element.style.clipPath = clipAround(element, hole.rect);
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
  veil.style.clipPath = clipAround(veil, hole.rect);
}

function sync() {
  const holes: { panel: HTMLElement; rect: Rect; covers: Rect[] }[] = [];
  for (const [frame, dock] of docks) {
    const element = frameOf(frame);
    const panel = element?.closest<HTMLElement>('[data-layer]');
    const shown =
      element && panel && visibility !== 'hidden' && visibility !== null
        ? panel.dataset.hidden === 'false'
        : false;
    let rect: Rect | null = null;
    let covers: Rect[] = [];
    if (shown && element && panel) {
      const origin = layoutRect(element);
      rect = {
        x: Math.round(origin.x + dock.rect.x),
        y: Math.round(origin.y + dock.rect.y),
        width: Math.round(dock.rect.width),
        height: Math.round(dock.rect.height),
      };
      covers = holesAbove(element).map(({ x, y, width, height }) => ({ x, y, width, height }));
      holes.push({ panel, rect, covers });
    }
    const message = {
      pluginId: dock.pluginId,
      appId: dock.app,
      rect,
      covers,
      workspace: dock.workspace,
    };
    const sent = JSON.stringify(message);
    if (sent === dock.sent) continue;
    dock.sent = sent;
    invoke('dock_window', message).catch((error: unknown) => {
      console.error('Cannot place the window:', error);
      // Nothing under the hole: close it.
      if (docks.get(frame) === dock && rect) {
        docks.delete(frame);
        sync();
      }
    });
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
    await invoke('dock_window', { pluginId, appId: app, rect: null, covers: [], workspace });
    sync();
    return null;
  }
  if (!isRect(rect) || rect.width < 1 || rect.height < 1)
    throw new Error("'rect' is not a rectangle");
  // Checked by the core before the overlay opens a hole for it.
  docks.set(frame, { pluginId, app, rect, workspace, sent: '' });
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
  }).catch(() => undefined);
  sync();
}
