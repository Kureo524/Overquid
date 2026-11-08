import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Clock } from './Clock';
import { loadLayout, saveLayout, type Layout, type PanelLayout, type Size } from './layout';
import {
  dismissOverlay,
  regionsOf,
  releaseKeyboard,
  sameRegions,
  setPinnedRegions,
  useOverlayStatus,
  type OverlayMode,
  type Rect,
} from './overlay';
import { Panel } from './Panel';

const modeLabel: Record<OverlayMode, string> = {
  'layer-shell': 'Wayland layer-shell',
  fallback: 'Always-on-top window',
};

type PanelId = 'welcome' | 'clock';

/** Where panels go until the user moves them: welcome centred, clock top right. */
const defaults: Record<PanelId, PanelLayout> = {
  welcome: { placement: { h: 'center', v: 'center', dx: 0, dy: 0 }, pinned: false },
  clock: { placement: { h: 'right', v: 'top', dx: 16, dy: 16 }, pinned: false },
};

/** Window size. The window is created hidden, at a temporary size, so
 * positions must follow it rather than be computed once at load. */
function useViewport(): Size {
  const read = () => ({ width: window.innerWidth, height: window.innerHeight });
  const [viewport, setViewport] = useState(read);
  useEffect(() => {
    const onResize = () => setViewport(read());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return viewport;
}

/** The saved layout (null until loaded) and a setter that also saves it. */
function useLayout(): [Layout | null, (id: PanelId, change: Partial<PanelLayout>) => void] {
  const [layout, setLayout] = useState<Layout | null>(null);

  useEffect(() => {
    let active = true;
    loadLayout().then(
      (saved) => active && setLayout(saved),
      (error: unknown) => {
        console.error('Cannot load the panel layout:', error);
        if (active) setLayout({});
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const update = (id: PanelId, change: Partial<PanelLayout>) => {
    if (!layout) return;
    const next = { ...layout, [id]: { ...(layout[id] ?? defaults[id]), ...change } };
    setLayout(next);
    saveLayout(next).catch((error: unknown) =>
      console.error('Cannot save the panel layout:', error),
    );
  };

  return [layout, update];
}

export function App() {
  const { mode, visibility } = useOverlayStatus();
  const viewport = useViewport();
  const [layout, updateLayout] = useLayout();
  const lastRegions = useRef<Rect[] | null>(null);
  const restorePending = useRef(true);

  const panel = (id: PanelId) => layout?.[id] ?? defaults[id];
  const summoned = visibility === 'summoned';
  // Pinned panels stay rendered while hidden (the window is unmapped then):
  // their rectangles are needed to bring them back at startup.
  const visible = (id: PanelId) => layout !== null && (summoned || panel(id).pinned);

  // Tell the core where the pinned panels are: in pinned mode they are the
  // only areas that take clicks. The first report after loading the layout
  // also brings saved pinned panels back on screen.
  useLayoutEffect(() => {
    if (!layout) return;
    const regions = regionsOf(document.querySelectorAll('[data-pinned="true"]'));
    const restore = restorePending.current;
    if (!restore && lastRegions.current && sameRegions(lastRegions.current, regions)) return;
    restorePending.current = false;
    lastRegions.current = regions;
    void setPinnedRegions(regions, restore);
  });

  // Leaving the summoned state: drop keyboard focus from any control, so keys
  // typed for the app underneath never activate a panel button.
  useEffect(() => {
    if (!summoned && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, [summoned]);

  // Hide on key *release*: hiding on keydown unmaps the window before the
  // release arrives, WebKitGTK then believes Escape is still held and drops
  // the next press after the overlay is shown again.
  useEffect(() => {
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      void (summoned ? dismissOverlay() : releaseKeyboard());
    };
    window.addEventListener('keyup', onKeyUp);
    return () => window.removeEventListener('keyup', onKeyUp);
  }, [summoned]);

  // A pinned panel gives the keyboard back as soon as the pointer leaves it.
  const onLeave = summoned ? undefined : () => void releaseKeyboard();
  const panelProps = (id: PanelId) => ({
    placement: panel(id).placement,
    pinned: panel(id).pinned,
    viewport,
    onPlace: (placement: PanelLayout['placement']) => updateLayout(id, { placement }),
    onTogglePin: () => updateLayout(id, { pinned: !panel(id).pinned }),
    onPointerLeave: onLeave,
  });

  return (
    <main className={summoned ? 'stage stage--summoned' : 'stage'}>
      {visible('welcome') && (
        <Panel
          title="Overquid"
          meta={<span className="mono">{mode ? modeLabel[mode] : '…'}</span>}
          width={360}
          {...panelProps('welcome')}
        >
          <p>Pin a panel to keep it on screen once the overlay is closed.</p>
          <dl className="keys">
            <dt>
              <kbd>Esc</kbd>
            </dt>
            <dd>Close the overlay, keep pinned panels</dd>
            <dt>
              <kbd>overquid toggle</kbd>
            </dt>
            <dd>Show or close from any hotkey</dd>
          </dl>
        </Panel>
      )}
      {visible('clock') && (
        <Panel title="Clock" width={200} {...panelProps('clock')}>
          <Clock running={visibility !== 'hidden'} />
        </Panel>
      )}
    </main>
  );
}
