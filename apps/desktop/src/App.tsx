import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Clock } from './Clock';
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
import { Panel, type PanelPosition } from './Panel';

const modeLabel: Record<OverlayMode, string> = {
  'layer-shell': 'Wayland layer-shell',
  fallback: 'Always-on-top window',
};

type PanelId = 'welcome' | 'clock';

/** Default spots, from the current window size: welcome centred, clock top right. */
const defaultPosition = (id: PanelId, viewport: Viewport): PanelPosition =>
  id === 'welcome'
    ? {
        x: Math.round(viewport.width / 2 - 180),
        y: Math.round(viewport.height / 2 - 90),
      }
    : { x: Math.max(16, viewport.width - 216), y: 16 };

interface Viewport {
  width: number;
  height: number;
}

/** Window size. The window is created hidden, at a temporary size, so default
 * positions must follow it rather than be computed once at load. */
function useViewport(): Viewport {
  const read = () => ({ width: window.innerWidth, height: window.innerHeight });
  const [viewport, setViewport] = useState(read);
  useEffect(() => {
    const onResize = () => setViewport(read());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return viewport;
}

export function App() {
  const { mode, visibility } = useOverlayStatus();
  const viewport = useViewport();
  // Positions the user dragged a panel to; others use their default spot.
  const [moved, setMoved] = useState<Partial<Record<PanelId, PanelPosition>>>({});
  const position = (id: PanelId) => moved[id] ?? defaultPosition(id, viewport);
  const [pinned, setPinned] = useState<Record<PanelId, boolean>>({ welcome: false, clock: false });
  const lastRegions = useRef<Rect[] | null>(null);

  const summoned = visibility === 'summoned';
  const visible = (id: PanelId) => summoned || (visibility === 'pinned' && pinned[id]);

  // Tell the core where the pinned panels are: in pinned mode they are the
  // only areas that take clicks.
  useLayoutEffect(() => {
    const regions = regionsOf(document.querySelectorAll('[data-pinned="true"]'));
    if (lastRegions.current && sameRegions(lastRegions.current, regions)) return;
    lastRegions.current = regions;
    void setPinnedRegions(regions);
  });

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

  const move = useCallback(
    (id: PanelId) => (position: PanelPosition) =>
      setMoved((current) => ({ ...current, [id]: position })),
    [],
  );
  const togglePin = (id: PanelId) => () =>
    setPinned((current) => ({ ...current, [id]: !current[id] }));
  // A pinned panel gives the keyboard back as soon as the pointer leaves it.
  const onLeave = summoned ? undefined : () => void releaseKeyboard();

  return (
    <main className={summoned ? 'stage stage--summoned' : 'stage'}>
      {visible('welcome') && (
        <Panel
          title="Overquid"
          meta={<span className="mono">{mode ? modeLabel[mode] : '…'}</span>}
          width={360}
          position={position('welcome')}
          pinned={pinned.welcome}
          onMove={move('welcome')}
          onTogglePin={togglePin('welcome')}
          onPointerLeave={onLeave}
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
        <Panel
          title="Clock"
          width={200}
          position={position('clock')}
          pinned={pinned.clock}
          onMove={move('clock')}
          onTogglePin={togglePin('clock')}
          onPointerLeave={onLeave}
        >
          <Clock running={visibility !== 'hidden'} />
        </Panel>
      )}
    </main>
  );
}
