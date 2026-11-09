import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { geometryChanged } from './geometry';
import { Menu } from './Menu';
import {
  clampSize,
  toPlacement,
  toPosition,
  type Placement,
  type Position,
  type Size,
} from './layout';

/** A layer menu entry. */
export type LayerAction = 'front' | 'back' | 'toggle-on-top';

interface PanelProps {
  title: string;
  meta?: ReactNode;
  width: number;
  /**
   * Height of the content area. When set, the content fills it and the panel
   * can be resized from its bottom-right corner (with `onResize`); otherwise
   * the panel takes the height of its content.
   */
  contentHeight?: number | undefined;
  placement: Placement;
  viewport: Size;
  pinned: boolean;
  /** Called once a drag ends, with where the panel was dropped. */
  onPlace: (placement: Placement) => void;
  /** Called once a resize ends, with the new content size and placement. */
  onResize?: ((size: Size, placement: Placement) => void) | undefined;
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

type Gesture =
  | { kind: 'drag'; dx: number; dy: number }
  | { kind: 'resize'; x: number; y: number; from: Size; at: Position };

/** A glass panel that can be dragged by its title bar, resized and pinned. */
export function Panel({
  title,
  meta,
  width,
  contentHeight,
  placement,
  viewport,
  pinned,
  onPlace,
  onResize,
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
  const [live, setLive] = useState<{ position: Position; content?: Size } | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

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

  const resizable = contentHeight !== undefined && onResize !== undefined;
  const content: Size | null =
    live?.content ?? (contentHeight === undefined ? null : { width, height: contentHeight });
  const panelWidth = content?.width ?? width;
  const size: Size = {
    width: panelWidth + BORDER_WIDTH,
    height: content ? content.height + CHROME_HEIGHT : height,
  };
  const position = live?.position ?? toPosition(placement, size, viewport);

  const startGesture = (event: PointerEvent<HTMLElement>, next: Gesture) => {
    gesture.current = next;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onBarDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    startGesture(event, {
      kind: 'drag',
      dx: event.clientX - position.x,
      dy: event.clientY - position.y,
    });
  };

  const onResizeDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !content) return;
    event.stopPropagation();
    startGesture(event, {
      kind: 'resize',
      x: event.clientX,
      y: event.clientY,
      from: content,
      at: position,
    });
  };

  const onMove = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (!current) return;
    if (current.kind === 'drag') {
      const x = Math.round(event.clientX - current.dx);
      const y = Math.round(event.clientY - current.dy);
      // Clamp through a placement round trip, so the panel cannot leave the screen.
      setLive({ position: toPosition(toPlacement({ x, y }, size, viewport), size, viewport) });
      return;
    }
    // The top-left corner stays put; the content may grow up to the screen edge.
    const max = {
      width: viewport.width - current.at.x - BORDER_WIDTH,
      height: viewport.height - current.at.y - CHROME_HEIGHT,
    };
    const next = clampSize(
      {
        width: current.from.width + event.clientX - current.x,
        height: current.from.height + event.clientY - current.y,
      },
      max,
    );
    setLive({ position: current.at, content: next });
  };

  const endGesture = () => {
    const current = gesture.current;
    gesture.current = null;
    if (!current || !live) return;
    const placed = toPlacement(live.position, size, viewport);
    if (current.kind === 'resize' && live.content) onResize?.(live.content, placed);
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
      className="glass panel"
      style={{
        width: panelWidth,
        left: position.x,
        top: position.y,
        zIndex: layer,
        visibility: hidden ? 'hidden' : undefined,
      }}
      aria-hidden={hidden || undefined}
      data-pinned={pinned}
      data-layer={layer}
      data-hidden={hidden}
      onPointerDownCapture={onRaise}
      aria-label={title}
      onPointerLeave={(event) => {
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
      {resizable && (
        <div
          className="panel__resize"
          aria-hidden="true"
          title="Resize"
          onPointerDown={onResizeDown}
          {...gestureHandlers}
        />
      )}
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
