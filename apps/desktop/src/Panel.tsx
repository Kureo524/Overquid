import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { geometryChanged, layoutRect } from './geometry';
import { Menu } from './Menu';
import {
  MAXIMIZED_LAYER,
  MIN_SIZE,
  RESIZE_EDGES,
  resizeBox,
  toPlacement,
  toPosition,
  type Box,
  type Placement,
  type Position,
  type ResizeEdge,
  type Size,
} from './layout';
import type { Modifier, SnapSettings } from './settings/settings';
import { snapMove, snapResize, type Guide } from './snap';

/** A layer menu entry. */
export type LayerAction = 'front' | 'back' | 'toggle-on-top';

interface PanelProps {
  title: string;
  meta?: ReactNode;
  width: number;
  /**
   * Height of the content area. When set, the content fills it and the panel
   * can be resized from its sides and corners (with `onResize`); otherwise the
   * panel takes the height of its content.
   */
  contentHeight?: number | undefined;
  placement: Placement;
  viewport: Size;
  snap: SnapSettings;
  /** The lines a moving panel sticks to, for as long as it does. */
  onGuides: (guides: Guide[]) => void;
  pinned: boolean;
  /** Called once a drag ends, with where the panel was dropped. */
  onPlace: (placement: Placement) => void;
  /** Called once a resize ends, with the new content size and placement. */
  onResize?: ((size: Size, placement: Placement) => void) | undefined;
  /** Covers the whole screen, in front of the other panels, until restored. */
  maximized: boolean;
  /** A double click on the panel's frame maximizes it or restores it. */
  onToggleMaximize: () => void;
  onTogglePin: () => void;
  onPointerLeave?: (() => void) | undefined;
  /** Kept in the page but not shown (plugin panels stay loaded while hidden). */
  hidden?: boolean;
  /** Place in the stack (`layerOf`): higher is in front. */
  layer: number;
  onTop: boolean;
  /** Called on any press in the panel: it comes to the front. */
  onRaise: () => void;
  onLayer: (action: LayerAction) => void;
  /** Removes the panel from the current overlay. */
  onClose: () => void;
  children: ReactNode;
}

/** Height around the content area: borders, title bar and body padding (styles.css). */
const CHROME_HEIGHT = 2 + 32 + 30;
const BORDER_WIDTH = 2;
/** Smallest outer size of a resized panel. */
const MIN_BOX: Size = {
  width: MIN_SIZE.width + BORDER_WIDTH,
  height: MIN_SIZE.height + CHROME_HEIGHT,
};
/** How close to a corner the pointer must be for its resize mark to show. */
const NEAR_CORNER = 40;

type Corner = 'ne' | 'nw' | 'se' | 'sw';

/** Where a panel being moved or resized is, until the gesture ends. */
interface Live {
  position: Position;
  content?: Size;
}

type GestureKind =
  | { kind: 'drag'; dx: number; dy: number }
  | { kind: 'resize'; edge: ResizeEdge; x: number; y: number; from: Box };

type Gesture = GestureKind & {
  /** Panels to snap to, measured when the gesture starts. */
  others: Box[];
  /** Last pointer position: pressing the snap key must apply without a move. */
  pointer: Position;
};

/** The panels on screen other than `self`. */
function otherPanels(self: HTMLElement | null): Box[] {
  const panels = document.querySelectorAll<HTMLElement>('.panel[data-hidden="false"]');
  return Array.from(panels)
    .filter((panel) => panel !== self)
    .map(layoutRect);
}

/** The corner of `box` within `NEAR_CORNER` of the point, if any. */
function cornerNear(box: DOMRect, x: number, y: number): Corner | null {
  const dx = Math.min(x - box.left, box.right - x);
  const dy = Math.min(y - box.top, box.bottom - y);
  if (Math.hypot(dx, dy) > NEAR_CORNER) return null;
  const v = y - box.top < box.bottom - y ? 'n' : 's';
  const h = x - box.left < box.right - x ? 'w' : 'e';
  return `${v}${h}`;
}

/** A glass panel that can be dragged by its title bar, resized and pinned. */
export function Panel({
  title,
  meta,
  width,
  contentHeight,
  placement,
  viewport,
  snap,
  onGuides,
  pinned,
  onPlace,
  onResize,
  maximized,
  onToggleMaximize,
  onTogglePin,
  onPointerLeave,
  hidden = false,
  layer,
  onTop,
  onRaise,
  onLayer,
  onClose,
  children,
}: PanelProps) {
  const ref = useRef<HTMLElement>(null);
  // Height depends on the content: measured, not passed in.
  const [height, setHeight] = useState(0);
  // While dragging or resizing, the panel follows the pointer; the layout is
  // only updated (and saved) once the gesture ends.
  const [live, setLiveState] = useState<Live | null>(null);
  // Read when the gesture ends: the last move may not have rendered yet.
  const liveNow = useRef<Live | null>(null);
  const setLive = (next: Live | null) => {
    liveNow.current = next;
    setLiveState(next);
  };
  const gesture = useRef<Gesture | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [near, setNear] = useState<Corner | null>(null);

  // Web panels cut out what is in front of them: tell them on every change.
  useLayoutEffect(() => geometryChanged());

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setHeight(element.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const resizable = contentHeight !== undefined && onResize !== undefined && !maximized;
  const fullScreen: Size = {
    width: viewport.width - BORDER_WIDTH,
    height: viewport.height - CHROME_HEIGHT,
  };
  const content: Size | null = maximized
    ? fullScreen
    : (live?.content ?? (contentHeight === undefined ? null : { width, height: contentHeight }));
  const panelWidth = content?.width ?? width;
  const size: Size = {
    width: panelWidth + BORDER_WIDTH,
    height: content ? content.height + CHROME_HEIGHT : height,
  };
  const position = maximized
    ? { x: 0, y: 0 }
    : (live?.position ?? toPosition(placement, size, viewport));

  const startGesture = (event: PointerEvent<HTMLElement>, next: GestureKind) => {
    gesture.current = {
      ...next,
      others: otherPanels(ref.current),
      pointer: { x: event.clientX, y: event.clientY },
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onBarDown = (event: PointerEvent<HTMLElement>) => {
    if (maximized || event.button !== 0 || (event.target as Element).closest('button')) return;
    startGesture(event, {
      kind: 'drag',
      dx: event.clientX - position.x,
      dy: event.clientY - position.y,
    });
  };

  const onResizeDown = (event: PointerEvent<HTMLElement>, edge: ResizeEdge) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    startGesture(event, {
      kind: 'resize',
      edge,
      x: event.clientX,
      y: event.clientY,
      from: { ...position, ...size },
    });
  };

  /** Follows the pointer; `snapping` makes the panel stick to the closest lines. */
  const follow = (pointer: Position, snapping: boolean) => {
    const current = gesture.current;
    if (!current) return;
    current.pointer = pointer;
    if (current.kind === 'drag') {
      const x = Math.round(pointer.x - current.dx);
      const y = Math.round(pointer.y - current.dy);
      // Clamp through a placement round trip, so the panel cannot leave the screen.
      const clamped = toPosition(toPlacement({ x, y }, size, viewport), size, viewport);
      const snapped = snapping ? snapMove({ ...clamped, ...size }, current.others, viewport) : null;
      setLive({ position: snapped ? { x: snapped.box.x, y: snapped.box.y } : clamped });
      onGuides(snapped?.guides ?? []);
      return;
    }
    const resized = resizeBox(
      current.from,
      current.edge,
      pointer.x - current.x,
      pointer.y - current.y,
      MIN_BOX,
      viewport,
    );
    const snapped = snapping
      ? snapResize(resized, current.edge, current.others, MIN_BOX, viewport)
      : null;
    const box = snapped?.box ?? resized;
    setLive({
      position: { x: box.x, y: box.y },
      content: { width: box.width - BORDER_WIDTH, height: box.height - CHROME_HEIGHT },
    });
    onGuides(snapped?.guides ?? []);
  };

  const isSnapping = (event: { getModifierState: (key: Modifier) => boolean }) =>
    snap.mode === 'always' || (snap.mode === 'hold' && event.getModifierState(snap.key));

  const onMove = (event: PointerEvent<HTMLElement>) =>
    follow({ x: event.clientX, y: event.clientY }, isSnapping(event));

  // Pressing or releasing the snap key during a gesture applies at once.
  const onSnapKey = useRef<(event: KeyboardEvent) => void>(() => undefined);
  onSnapKey.current = (event) => {
    if (gesture.current) follow(gesture.current.pointer, isSnapping(event));
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => onSnapKey.current(event);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);

  const endGesture = () => {
    const current = gesture.current;
    const last = liveNow.current;
    gesture.current = null;
    onGuides([]);
    if (!current || !last) return;
    const lastSize = last.content
      ? { width: last.content.width + BORDER_WIDTH, height: last.content.height + CHROME_HEIGHT }
      : size;
    const placed = toPlacement(last.position, lastSize, viewport);
    if (current.kind === 'resize' && last.content) onResize?.(last.content, placed);
    else onPlace(placed);
    setLive(null);
  };

  const gestureHandlers = {
    onPointerMove: onMove,
    onPointerUp: endGesture,
    onPointerCancel: endGesture,
  };

  return (
    <section
      ref={ref}
      className={maximized ? 'glass panel panel--maximized' : 'glass panel'}
      style={{
        width: panelWidth,
        left: position.x,
        top: position.y,
        zIndex: maximized ? MAXIMIZED_LAYER : layer,
        visibility: hidden ? 'hidden' : undefined,
      }}
      aria-hidden={hidden || undefined}
      data-pinned={pinned}
      data-layer={maximized ? MAXIMIZED_LAYER : layer}
      data-hidden={hidden}
      onPointerDownCapture={onRaise}
      aria-label={title}
      onDoubleClick={(event) => {
        const target = event.target as Element;
        const onFrame =
          target.classList.contains('panel__body') ||
          target.closest('.panel__edge') !== null ||
          (target.closest('.panel__bar') !== null && target.closest('button') === null);
        if (onFrame) onToggleMaximize();
      }}
      onPointerMove={(event) => {
        if (!resizable || gesture.current) return;
        const corner = cornerNear(
          event.currentTarget.getBoundingClientRect(),
          event.clientX,
          event.clientY,
        );
        if (corner !== near) setNear(corner);
      }}
      onPointerLeave={(event) => {
        setNear(null);
        // Moving into a plugin's iframe also "leaves" the panel's document:
        // only count it when the pointer is really outside the panel.
        const box = event.currentTarget.getBoundingClientRect();
        const inside =
          event.clientX > box.left &&
          event.clientX < box.right &&
          event.clientY > box.top &&
          event.clientY < box.bottom;
        if (!inside) onPointerLeave?.();
      }}
    >
      <header className="panel__bar" onPointerDown={onBarDown} {...gestureHandlers}>
        <span className="panel__title">{title}</span>
        <span className="panel__actions">
          {meta}
          <button
            type="button"
            className="icon-button"
            aria-label={`Layer of ${title}`}
            aria-haspopup="menu"
            aria-expanded={menu !== null}
            title="Layer"
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              setMenu(menu ? null : { x: box.right, y: box.bottom + 4 });
              event.currentTarget.blur();
            }}
          >
            <LayersIcon />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-pressed={pinned}
            aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
            title={pinned ? 'Unpin' : 'Pin: keep visible when the overlay is closed'}
            onClick={(event) => {
              onTogglePin();
              // Do not keep focus: Space or Enter typed later (meant for the
              // app underneath) would toggle the pin again.
              event.currentTarget.blur();
            }}
          >
            <PinIcon />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={`Remove ${title} from this overlay`}
            title="Remove from this overlay"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </span>
      </header>
      <div
        className={content ? 'panel__body panel__body--fixed' : 'panel__body'}
        style={content ? { height: content.height } : undefined}
      >
        {children}
      </div>
      {resizable &&
        RESIZE_EDGES.map((edge) => (
          <div
            key={edge}
            className={`panel__edge panel__edge--${edge}`}
            aria-hidden="true"
            data-near={edge === near || undefined}
            onPointerDown={(event) => onResizeDown(event, edge)}
            {...gestureHandlers}
          />
        ))}
      {menu && !hidden && (
        <Menu
          at={menu}
          items={[
            { label: 'Bring to front', onPick: () => onLayer('front') },
            { label: 'Send to back', onPick: () => onLayer('back') },
            { label: 'Always on top', checked: onTop, onPick: () => onLayer('toggle-on-top') },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
    </section>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="m4.5 4.5 7 7m0-7-7 7" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    >
      <path d="M8 2 14 5.2 8 8.4 2 5.2Z" />
      <path d="M2 8.2 8 11.4 14 8.2M2 11 8 14.2 14 11" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M9.8 1.8 14.2 6.2 12.4 6.9 10.2 9.1 10.6 12.3 9.6 13.3 6.9 10.6 3 14.5 1.5 13 5.4 9.1 2.7 6.4 3.7 5.4 6.9 5.8 9.1 3.6Z"
        fill="currentColor"
      />
    </svg>
  );
}
