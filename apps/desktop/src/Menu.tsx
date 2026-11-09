import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { geometryChanged } from './geometry';

/** Stacking value of open menus: in front of every panel and the overlay bar. */
export const MENU_LAYER = 2_000_000;

export interface MenuItem {
  label: string;
  /** Shown as a check box when set. */
  checked?: boolean;
  disabled?: boolean;
  onPick: () => void;
}

interface MenuProps {
  /** Anchor point: the menu hangs below it, aligned left or right. */
  at: { x: number; y: number };
  align?: 'left' | 'right';
  items: MenuItem[];
  /** Shown when there is no item. */
  empty?: string;
  onClose: () => void;
}

/**
 * A small menu drawn on top of everything (outside the panels, which clip
 * their content). It counts as a layer, so web panels are cut under it.
 */
export function Menu({ at, align = 'right', items, empty, onClose }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onCloseRef.current();
    };
    // Next tick: the click that opened the menu must not close it.
    const timer = setTimeout(() => document.addEventListener('pointerdown', close));
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', close);
    };
  }, []);
  useLayoutEffect(() => {
    geometryChanged();
    return () => geometryChanged();
  }, []);

  // No transform: web panels measure this menu to cut it out of their view.
  const position =
    align === 'right' ? { right: window.innerWidth - at.x, top: at.y } : { left: at.x, top: at.y };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="glass menu"
      style={{ ...position, zIndex: MENU_LAYER }}
      data-layer={MENU_LAYER}
    >
      {items.length === 0 && empty && <p className="menu__empty">{empty}</p>}
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
          aria-checked={item.checked}
          className="menu__item"
          disabled={item.disabled}
          onClick={() => {
            item.onPick();
            onCloseRef.current();
          }}
        >
          <span className="menu__check" aria-hidden="true">
            {item.checked ? '✓' : ''}
          </span>
          {item.label}
        </button>
      ))}
    </div>,
    document.querySelector('.stage') ?? document.body,
  );
}
