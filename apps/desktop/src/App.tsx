import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  loadLayout,
  saveLayout,
  type Layout,
  type PanelLayout,
  type Placement,
  type Size,
} from './layout';
import {
  regionsOf,
  releaseKeyboard,
  sameRegions,
  setPinnedRegions,
  useOverlayStatus,
  type OverlayMode,
  type Rect,
} from './overlay';
import { Panel } from './Panel';
import { PluginFrame } from './PluginFrame';
import { WebSlot } from './WebSlot';
import { listPlugins, startBroker, type PluginManifest } from './plugins';

const modeLabel: Record<OverlayMode, string> = {
  'layer-shell': 'Wayland layer-shell',
  fallback: 'Always-on-top window',
};

/** Built-in panels, plus one panel per plugin, keyed by the plugin id. */
type PanelId = string;

const DEFAULT_PLUGIN_SIZE: [number, number] = [320, 240];

/** Where built-in panels go until the user moves them. */
const builtIn: Record<string, PanelLayout> = {
  welcome: { placement: { h: 'center', v: 'center', dx: 0, dy: 0 }, pinned: false },
};

const MARGIN = 16;
const atPosition: Record<NonNullable<PluginManifest['panel']['position']>, Placement> = {
  'top-left': { h: 'left', v: 'top', dx: MARGIN, dy: MARGIN },
  'top-right': { h: 'right', v: 'top', dx: MARGIN, dy: MARGIN },
  'bottom-left': { h: 'left', v: 'bottom', dx: MARGIN, dy: MARGIN },
  'bottom-right': { h: 'right', v: 'bottom', dx: MARGIN, dy: MARGIN },
  center: { h: 'center', v: 'center', dx: 0, dy: 0 },
};

/** Default spot of a panel: built-in ones by name, plugins where their
 * manifest asks, or cascading from the top left. */
function defaultLayout(id: PanelId, plugins: PluginManifest[]): PanelLayout {
  const known = builtIn[id];
  if (known) return known;
  const index = Math.max(
    0,
    plugins.findIndex((plugin) => plugin.id === id),
  );
  const position = plugins[index]?.panel.position;
  const offset = MARGIN + 32 * index;
  return {
    placement: position ? atPosition[position] : { h: 'left', v: 'top', dx: offset, dy: offset },
    pinned: false,
  };
}

/** Installed plugins (null until listed), and the broker relaying their
 * calls (ADR 0003). */
function usePlugins(): PluginManifest[] | null {
  const [plugins, setPlugins] = useState<PluginManifest[] | null>(null);
  useEffect(() => startBroker(), []);
  useEffect(() => {
    listPlugins().then(setPlugins, (error: unknown) => {
      console.error('Cannot list plugins:', error);
      setPlugins([]);
    });
  }, []);
  return plugins;
}

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
function useLayout(
  defaults: (id: PanelId) => PanelLayout,
): [Layout | null, (id: PanelId, change: Partial<PanelLayout>) => void] {
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
    const next = { ...layout, [id]: { ...(layout[id] ?? defaults(id)), ...change } };
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
  const listed = usePlugins();
  const plugins = listed ?? [];
  const defaults = (id: PanelId) => defaultLayout(id, plugins);
  const [layout, updateLayout] = useLayout(defaults);
  const lastRegions = useRef<Rect[] | null>(null);
  const restorePending = useRef(true);

  const panel = (id: PanelId) => layout?.[id] ?? defaults(id);
  const summoned = visibility === 'summoned';
  // Pinned panels stay rendered while hidden (the window is unmapped then):
  // their rectangles are needed to bring them back at startup.
  const visible = (id: PanelId) => layout !== null && (summoned || panel(id).pinned);
  // What the user actually sees (the window is unmapped while hidden).
  const onScreen = (id: PanelId) => summoned || (visibility === 'pinned' && panel(id).pinned);

  // Tell the core where the pinned panels are: in pinned mode they are the
  // only areas that take clicks. The first report after loading the layout
  // also brings saved pinned panels back on screen: it must wait for both the
  // layout and the plugins, or pinned plugin panels are not in the page yet.
  useLayoutEffect(() => {
    if (!layout || !listed) return;
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

  // Escape is handled by the core on the GTK window (it must also work while
  // a plugin's iframe has the focus, which this page cannot see).

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
      {/* Plugin panels stay loaded while hidden, so plugins keep their state
          and get onHide; they are only made invisible. */}
      {layout !== null &&
        plugins.map((plugin) => {
          const [width, height] = plugin.panel.defaultSize ?? DEFAULT_PLUGIN_SIZE;
          const size = panel(plugin.id).size ?? { width, height };
          return (
            <Panel
              key={plugin.id}
              title={plugin.name}
              width={size.width}
              contentHeight={size.height}
              onResize={(next, placement) => updateLayout(plugin.id, { size: next, placement })}
              hidden={!visible(plugin.id)}
              {...panelProps(plugin.id)}
            >
              {plugin.web ? (
                <WebSlot pluginId={plugin.id} name={plugin.name} visible={onScreen(plugin.id)} />
              ) : (
                <PluginFrame plugin={plugin} visible={onScreen(plugin.id)} />
              )}
            </Panel>
          );
        })}
    </main>
  );
}
