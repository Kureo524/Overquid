import { useLayoutEffect, useState, type KeyboardEvent } from 'react';
import { geometryChanged } from './geometry';
import { Menu, type MenuItem } from './Menu';
import type { Overlay } from './overlays';

/** In front of every panel, behind menus. */
export const BAR_LAYER = 1_500_000;

interface OverlayBarProps {
  overlays: Overlay[];
  active: string;
  /** Panels that can be added to the active overlay. */
  addable: { id: string; name: string }[];
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onAddPanel: (id: string) => void;
}

/** Tabs to switch between overlays, create, rename or delete them, and add panels (ADR 0006). */
export function OverlayBar({
  overlays,
  active,
  addable,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
  onAddPanel,
}: OverlayBarProps) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{
    kind: 'add' | 'overlay';
    x: number;
    y: number;
    id?: string;
  } | null>(null);

  // Web panels under the bar are cut where it is.
  useLayoutEffect(() => geometryChanged());

  const finishRename = (id: string, value: string) => {
    onRename(id, value);
    setRenaming(null);
  };

  const overlayItems = (id: string): MenuItem[] => [
    { label: 'Rename', onPick: () => setRenaming(id) },
    { label: 'Delete', disabled: overlays.length <= 1, onPick: () => onDelete(id) },
  ];

  return (
    <nav
      className="glass overlay-bar"
      aria-label="Overlays"
      style={{ zIndex: BAR_LAYER }}
      data-layer={BAR_LAYER}
    >
      <div className="overlay-bar__tabs" role="tablist">
        {overlays.map((overlay) =>
          renaming === overlay.id ? (
            <input
              key={overlay.id}
              className="overlay-bar__rename"
              aria-label="Overlay name"
              defaultValue={overlay.name}
              autoFocus
              onFocus={(event) => event.target.select()}
              onBlur={(event) => finishRename(overlay.id, event.target.value)}
              onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                if (event.key === 'Enter') finishRename(overlay.id, event.currentTarget.value);
              }}
            />
          ) : (
            <button
              key={overlay.id}
              type="button"
              role="tab"
              aria-selected={overlay.id === active}
              className="overlay-bar__tab"
              title="Double-click to rename, right-click for more"
              onClick={(event) => {
                onSwitch(overlay.id);
                event.currentTarget.blur();
              }}
              onDoubleClick={() => setRenaming(overlay.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                const box = event.currentTarget.getBoundingClientRect();
                setMenu({ kind: 'overlay', id: overlay.id, x: box.left, y: box.bottom + 6 });
              }}
            >
              {overlay.name}
            </button>
          ),
        )}
        <button
          type="button"
          className="icon-button"
          aria-label="New overlay"
          title="New overlay"
          onClick={(event) => {
            onCreate();
            event.currentTarget.blur();
          }}
        >
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
            <path d="M8 3v10M3 8h10" />
          </svg>
        </button>
      </div>
      <span className="overlay-bar__divider" aria-hidden="true" />
      <button
        type="button"
        className="overlay-bar__add"
        aria-haspopup="menu"
        aria-expanded={menu?.kind === 'add'}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setMenu(menu?.kind === 'add' ? null : { kind: 'add', x: box.right, y: box.bottom + 6 });
          event.currentTarget.blur();
        }}
      >
        Add panel
      </button>
      {menu?.kind === 'add' && (
        <Menu
          at={menu}
          items={addable.map((panel) => ({
            label: panel.name,
            onPick: () => onAddPanel(panel.id),
          }))}
          empty="Every panel is already here"
          onClose={() => setMenu(null)}
        />
      )}
      {menu?.kind === 'overlay' && menu.id && (
        <Menu at={menu} align="left" items={overlayItems(menu.id)} onClose={() => setMenu(null)} />
      )}
    </nav>
  );
}
