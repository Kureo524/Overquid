/** Top-left corner of a panel, in CSS pixels. */
export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * Where a panel sits, relative to the screen edge or centre it is closest to.
 * Unlike raw pixels, this survives a change of screen size: a panel in the
 * top-right corner stays in the top-right corner.
 */
export interface Placement {
  h: 'left' | 'center' | 'right';
  v: 'top' | 'center' | 'bottom';
  /** Distance from the anchor edge, or offset of the centre from the screen centre. */
  dx: number;
  dy: number;
}

export interface PanelLayout {
  placement: Placement;
  pinned: boolean;
  /** Panel width and content height, once the user resized the panel. */
  size?: Size;
  /** Place in the stack: higher is in front. Panels never raised are at 0. */
  z?: number;
  /** Kept in front of every other panel. */
  onTop?: boolean;
}

export type Layout = Record<string, PanelLayout>;

/** Format of a single layout: before overlays (ADR 0006), and inside each overlay. */
export const LAYOUT_VERSION = 1;

type Anchor = 'start' | 'center' | 'end';

/** Anchor of a span `[start, start + size)` on an axis of `length`: by thirds. */
function anchorOf(start: number, size: number, length: number): { anchor: Anchor; offset: number } {
  const middle = start + size / 2;
  if (middle < length / 3) return { anchor: 'start', offset: start };
  if (middle > (2 * length) / 3) return { anchor: 'end', offset: length - start - size };
  return { anchor: 'center', offset: middle - length / 2 };
}

function startOf(anchor: Anchor, offset: number, size: number, length: number): number {
  const start =
    anchor === 'start'
      ? offset
      : anchor === 'end'
        ? length - size - offset
        : length / 2 + offset - size / 2;
  // Keep the whole panel on screen (pinned to the start if it is too big).
  return Math.round(Math.max(0, Math.min(start, length - size)));
}

const toH = { start: 'left', center: 'center', end: 'right' } as const;
const toV = { start: 'top', center: 'center', end: 'bottom' } as const;
const fromH = { left: 'start', center: 'center', right: 'end' } as const;
const fromV = { top: 'start', center: 'center', bottom: 'end' } as const;

export function toPlacement(position: Position, size: Size, viewport: Size): Placement {
  const h = anchorOf(position.x, size.width, viewport.width);
  const v = anchorOf(position.y, size.height, viewport.height);
  return {
    h: toH[h.anchor],
    v: toV[v.anchor],
    dx: Math.round(h.offset),
    dy: Math.round(v.offset),
  };
}

export function toPosition(placement: Placement, size: Size, viewport: Size): Position {
  return {
    x: startOf(fromH[placement.h], placement.dx, size.width, viewport.width),
    y: startOf(fromV[placement.v], placement.dy, size.height, viewport.height),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parsePanel(value: unknown): PanelLayout | null {
  if (!isRecord(value) || !isRecord(value.placement)) return null;
  const { h, v, dx, dy } = value.placement;
  if (h !== 'left' && h !== 'center' && h !== 'right') return null;
  if (v !== 'top' && v !== 'center' && v !== 'bottom') return null;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  const panel: PanelLayout = {
    placement: { h, v, dx: dx as number, dy: dy as number },
    pinned: value.pinned === true,
  };
  const size = parseSize(value.size);
  if (size) panel.size = size;
  if (typeof value.z === 'number' && Number.isFinite(value.z)) panel.z = Math.round(value.z);
  if (value.onTop === true) panel.onTop = true;
  return panel;
}

const isLength = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

function parseSize(value: unknown): Size | null {
  if (!isRecord(value) || !isLength(value.width) || !isLength(value.height)) return null;
  return { width: Math.round(value.width), height: Math.round(value.height) };
}

/** Smallest size a panel can be resized to (panel width, content height). */
export const MIN_SIZE: Size = { width: 160, height: 60 };

/** Clamps a content size between `MIN_SIZE` and `max`. */
export function clampSize(size: Size, max: Size): Size {
  const clamp = (value: number, min: number, limit: number) =>
    Math.round(Math.max(min, Math.min(value, Math.max(min, limit))));
  return {
    width: clamp(size.width, MIN_SIZE.width, max.width),
    height: clamp(size.height, MIN_SIZE.height, max.height),
  };
}

/** Reads a saved layout, dropping anything malformed instead of failing. */
export function parseLayout(value: unknown): Layout {
  if (!isRecord(value) || value.version !== LAYOUT_VERSION || !isRecord(value.panels)) return {};
  const layout: Layout = {};
  for (const [id, panel] of Object.entries(value.panels)) {
    const parsed = parsePanel(panel);
    if (parsed) layout[id] = parsed;
  }
  return layout;
}

/** Panels that moved to another id (built-in clock → clock plugin). */
const RENAMED: Record<string, string> = { clock: 'dev.overquid.clock' };

/** Carries saved positions over to renamed panels, unless already set. */
export function migrateLayout(layout: Layout): Layout {
  const migrated: Layout = {};
  for (const [id, panel] of Object.entries(layout)) {
    const target = RENAMED[id];
    if (!target) migrated[id] = panel;
  }
  for (const [from, to] of Object.entries(RENAMED)) {
    const old = layout[from];
    if (old && !layout[to]) migrated[to] = old;
  }
  return migrated;
}

export const serializeLayout = (layout: Layout) => ({ version: LAYOUT_VERSION, panels: layout });

/** Panels kept on top stay above this offset, in their own order. */
const ON_TOP = 1_000_000;

/** Stacking value of a panel: what the DOM `z-index` and the clipping of web panels use. */
export const layerOf = (panel: PanelLayout): number => (panel.z ?? 0) + (panel.onTop ? ON_TOP : 0);

/** The `z` that puts `id` in front of (or behind) every other panel of its kind. */
export function restack(layout: Layout, id: string, to: 'front' | 'back'): number {
  const own = layout[id];
  const others = Object.entries(layout)
    .filter(([other, panel]) => other !== id && Boolean(panel.onTop) === Boolean(own?.onTop))
    .map(([, panel]) => panel.z ?? 0);
  if (others.length === 0) return own?.z ?? 0;
  return to === 'front' ? Math.max(...others) + 1 : Math.min(...others) - 1;
}

/** Whether `id` is already in front of every other panel of its kind. */
export function isInFront(layout: Layout, id: string): boolean {
  const own = layout[id];
  const z = own?.z ?? 0;
  return Object.entries(layout).every(
    ([other, panel]) =>
      other === id || Boolean(panel.onTop) !== Boolean(own?.onTop) || (panel.z ?? 0) < z,
  );
}
