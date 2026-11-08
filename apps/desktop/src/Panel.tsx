import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { toPlacement, toPosition, type Placement, type Position, type Size } from './layout';

interface PanelProps {
  title: string;
  meta?: ReactNode;
  width: number;
  placement: Placement;
  viewport: Size;
  pinned: boolean;
  /** Called once a drag ends, with where the panel was dropped. */
  onPlace: (placement: Placement) => void;
  onTogglePin: () => void;
  onPointerLeave?: (() => void) | undefined;
  children: ReactNode;
}

/** A glass panel that can be dragged by its title bar and pinned. */
export function Panel({
  title,
  meta,
  width,
  placement,
  viewport,
  pinned,
  onPlace,
  onTogglePin,
  onPointerLeave,
  children,
}: PanelProps) {
  const ref = useRef<HTMLElement>(null);
  // Height depends on the content: measured, not passed in.
  const [height, setHeight] = useState(0);
  const size: Size = { width, height };
  // While dragging, the panel follows the pointer; the placement is only
  // updated (and saved) on drop.
  const [dragged, setDragged] = useState<Position | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setHeight(element.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const position = dragged ?? toPosition(placement, size, viewport);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    drag.current = { dx: event.clientX - position.x, dy: event.clientY - position.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    const x = Math.round(event.clientX - drag.current.dx);
    const y = Math.round(event.clientY - drag.current.dy);
    // Clamp through a placement round trip, so the panel cannot leave the screen.
    setDragged(toPosition(toPlacement({ x, y }, size, viewport), size, viewport));
  };
  const endDrag = () => {
    drag.current = null;
    if (!dragged) return;
    onPlace(toPlacement(dragged, size, viewport));
    setDragged(null);
  };

  return (
    <section
      ref={ref}
      className="glass panel"
      style={{ width, left: position.x, top: position.y }}
      data-pinned={pinned}
      aria-label={title}
      onPointerLeave={onPointerLeave}
    >
      <header
        className="panel__bar"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span className="panel__title">{title}</span>
        <span className="panel__actions">
          {meta}
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
        </span>
      </header>
      <div className="panel__body">{children}</div>
    </section>
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
