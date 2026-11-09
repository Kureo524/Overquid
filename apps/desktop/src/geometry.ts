import type { Rect } from './overlay';

/**
 * Tells web panels that something on screen may have moved: a panel was
 * dragged, resized, raised, shown or hidden. Each web panel then measures
 * itself and the panels in front of it again (ADR 0004: native views are cut
 * where panels in front of them are).
 */
const listeners = new Set<() => void>();
let scheduled = false;

export function onGeometryChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Batches the calls of one render into a single notification. */
export function geometryChanged(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    listeners.forEach((listener) => listener());
  });
}

/**
 * An element's rectangle in the page, ignoring CSS transforms: the overlay
 * zooms in when summoned, and `getBoundingClientRect` would catch the first
 * frame of that animation, leaving native views slightly off for good.
 */
export function layoutRect(element: HTMLElement): Rect {
  let x = 0;
  let y = 0;
  for (let node: Element | null = element; node instanceof HTMLElement; node = node.offsetParent) {
    x += node.offsetLeft + node.clientLeft;
    y += node.offsetTop + node.clientTop;
  }
  // The element's own border is inside its rectangle.
  x -= element.clientLeft;
  y -= element.clientTop;
  return { x, y, width: element.offsetWidth, height: element.offsetHeight };
}

/** Stacking value of a layer element (`data-layer`), or null if it is not shown. */
function layerValue(element: HTMLElement): number | null {
  if (element.dataset.hidden === 'true') return null;
  const value = Number(element.dataset.layer);
  return Number.isFinite(value) ? value : null;
}

/** A layer in front of a web panel, with its corner radius (`web_panels::Hole`). */
export interface Hole extends Rect {
  radius: number;
}

/**
 * The layers in front of `element`'s own layer (a panel, a menu…): the parts
 * of a web panel's native view that must be cut out.
 */
export function holesAbove(element: HTMLElement): Hole[] {
  const own = element.closest<HTMLElement>('[data-layer]');
  const ownLayer = own ? layerValue(own) : null;
  if (!own || ownLayer === null) return [];
  const holes: Hole[] = [];
  document.querySelectorAll<HTMLElement>('[data-layer]').forEach((other) => {
    if (other === own) return;
    const layer = layerValue(other);
    // Equal layers: the later one in the page is drawn in front.
    const inFront =
      layer !== null &&
      (layer > ownLayer ||
        (layer === ownLayer &&
          Boolean(own.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING)));
    if (inFront) {
      const radius = Number.parseFloat(getComputedStyle(other).borderTopLeftRadius) || 0;
      holes.push({ ...layoutRect(other), radius });
    }
  });
  return holes;
}
