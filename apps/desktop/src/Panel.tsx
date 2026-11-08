import { useRef, type PointerEvent, type ReactNode } from 'react';

export interface PanelPosition {
  x: number;
  y: number;
}

interface PanelProps {
  title: string;
  meta?: ReactNode;
  width: number;
  position: PanelPosition;
  pinned: boolean;
  onMove: (position: PanelPosition) => void;
  onTogglePin: () => void;
  onPointerLeave?: (() => void) | undefined;
  children: ReactNode;
}

/** A glass panel that can be dragged by its title bar and pinned. */
export function Panel({
  title,
  meta,
  width,
  position,
  pinned,
  onMove,
  onTogglePin,
  onPointerLeave,
  children,
}: PanelProps) {
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    drag.current = { dx: event.clientX - position.x, dy: event.clientY - position.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    onMove({
      x: Math.max(0, Math.round(event.clientX - drag.current.dx)),
      y: Math.max(0, Math.round(event.clientY - drag.current.dy)),
    });
  };
  const endDrag = () => {
    drag.current = null;
  };

  return (
    <section
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
            onClick={onTogglePin}
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
