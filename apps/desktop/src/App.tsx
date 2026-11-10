import { listen } from '@tauri-apps/api/event';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  isInFront,
  layerOf,
  restack,
  type Layout,
  type PanelLayout,
  type Placement,
  type Size,
} from './layout';
import {
  activeOverlay,
  addPanels,
  createOverlay,
  cycle,
  deleteOverlay,
  loadOverlays,
  removePanel,
  renameOverlay,
  saveOverlays,
  overlayForApp,
  switchByName,
  toggleApp,
  updatePanel,
  STARTER_PANELS,
  type Fill,
  type Overlays,
} from './overlays';
import { OverlayBar } from './OverlayBar';
import { useActiveApp } from './activeApp';
import { instanceOf, nextPanelId, panelIdsIn, panelTitle, pluginOf } from './instances';
import {
  regionsOf,
  releaseKeyboard,
  sameRegions,
  setPinnedRegions,
  useOverlayStatus,
  type OverlayMode,
  type Rect,
} from './overlay';
import { Browser } from './Browser';
import { Panel, type LayerAction } from './Panel';
import { PluginFrame } from './PluginFrame';
import { WebSlot } from './WebSlot';
import { broadcastTheme, listPlugins, startBroker, type PluginManifest } from './plugins';
import { SettingsWindow } from './settings/SettingsWindow';
import { useSettings } from './settings/settings';
import { applyTheme, themeTokens } from './theme';

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
/** Panels placed at the top start below the overlay bar (top 12, 40 high). */
const BELOW_BAR = 64;
const atPosition: Record<NonNullable<PluginManifest['panel']['position']>, Placement> = {
  'top-left': { h: 'left', v: 'top', dx: MARGIN, dy: BELOW_BAR },
  'top-right': { h: 'right', v: 'top', dx: MARGIN, dy: BELOW_BAR },
  'bottom-left': { h: 'left', v: 'bottom', dx: MARGIN, dy: MARGIN },
  'bottom-right': { h: 'right', v: 'bottom', dx: MARGIN, dy: MARGIN },
  center: { h: 'center', v: 'center', dx: 0, dy: 0 },
};

/** Default spot of a panel: built-in ones by name, plugins where their
 * manifest asks, or cascading from the top left. */
function defaultLayout(id: PanelId, plugins: PluginManifest[]): PanelLayout {
  const known = builtIn[id];
  if (known) return known;
  const pluginId = pluginOf(id);
  const index = Math.max(
    0,
    plugins.findIndex((plugin) => plugin.id === pluginId),
  );
  const position = plugins[index]?.panel.position;
  // Another instance opens a little lower and to the right of the first one.
  const shift = 32 * (instanceOf(id) - 1);
  const placement = position
    ? atPosition[position]
    : {
        h: 'left' as const,
        v: 'top' as const,
        dx: MARGIN + 32 * index,
        dy: BELOW_BAR + 32 * index,
      };
  return {
    placement: {
      ...placement,
      dx: placement.dx + (placement.h === 'right' ? -shift : shift),
      dy: placement.dy + (placement.v === 'bottom' ? -shift : shift),
    },
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

/** Presses inside a web panel's native view, which the page never sees. */
function useWebPanelPresses(onPress: (pluginId: string) => void) {
  useEffect(() => {
    const stop = listen<string>('web-panel-pressed', (event) => onPress(event.payload));
    return () => void stop.then((unlisten) => unlisten());
  }, [onPress]);
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

/** What `overquid next|prev|switch NAME` sends (`cli::OverlaySwitch`). */
type OverlaySwitch = { kind: 'next' } | { kind: 'prev' } | { kind: 'switch'; name: string };

/**
 * The saved overlays (null until loaded) and a setter that also saves them.
 * A first run opens a few light panels (`STARTER_PANELS`); a layout saved
 * before overlays existed gets every installed panel, so nothing disappears.
 */
function useOverlays(
  plugins: PluginManifest[] | null,
  defaults: (id: PanelId) => PanelLayout,
): [Overlays | null, (next: Overlays) => void] {
  const [overlays, setOverlays] = useState<Overlays | null>(null);
  const [fill, setFill] = useState<Fill>(null);

  const commit = (next: Overlays) => {
    setOverlays(next);
    saveOverlays(next).catch((error: unknown) => console.error('Cannot save the overlays:', error));
  };

  useEffect(() => {
    let active = true;
    loadOverlays().then(
      (loaded) => {
        if (!active) return;
        setOverlays(loaded.overlays);
        setFill(loaded.fill);
      },
      (error: unknown) => {
        console.error('Cannot load the overlays:', error);
        if (active) {
          setOverlays({ active: 'main', overlays: [{ id: 'main', name: 'Main', panels: {} }] });
          setFill('starter');
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!fill || !overlays || !plugins) return;
    setFill(null);
    const installed = ['welcome', ...plugins.map((plugin) => plugin.id)];
    const ids =
      fill === 'starter' ? installed.filter((id) => STARTER_PANELS.includes(id)) : installed;
    commit(addPanels(overlays, Object.fromEntries(ids.map((id) => [id, defaults(id)]))));
  });

  return [fill ? null : overlays, commit];
}

/** `overquid next|prev|switch NAME`, relayed by the core. */
function useOverlaySwitches(onSwitch: (request: OverlaySwitch) => void) {
  const ref = useRef(onSwitch);
  ref.current = onSwitch;
  useEffect(() => {
    const stop = listen<OverlaySwitch>('overlay-switch', (event) => ref.current(event.payload));
    return () => void stop.then((unlisten) => unlisten());
  }, []);
}

export function App() {
  const { mode, visibility } = useOverlayStatus();
  const viewport = useViewport();
  const listed = usePlugins();
  const plugins = listed ?? [];
  const defaults = (id: PanelId) => defaultLayout(id, plugins);
  const [overlays, commit] = useOverlays(listed, defaults);
  const layout = overlays ? activeOverlay(overlays).panels : null;
  // The panel shown full screen. Not saved: it only lasts while the overlay is
  // summoned, so a pinned panel never takes the whole screen over a game.
  const [maximized, setMaximized] = useState<PanelId | null>(null);
  const [settings, updateSettings] = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const lastRegions = useRef<Rect[] | null>(null);
  const restorePending = useRef(true);

  const updateLayout = (id: PanelId, change: Partial<PanelLayout>) => {
    if (overlays) commit(updatePanel(overlays, id, change, defaults(id)));
  };
  // Changing overlays changes the pinned panels: bring the new ones on
  // screen (or hide everything) as at startup, without summoning.
  const changeOverlays = (next: Overlays) => {
    if (overlays && next.active !== overlays.active) restorePending.current = true;
    commit(next);
  };
  useOverlaySwitches((request) => {
    if (!overlays) return;
    if (request.kind === 'next') changeOverlays(cycle(overlays, 1));
    else if (request.kind === 'prev') changeOverlays(cycle(overlays, -1));
    else changeOverlays(switchByName(overlays, request.name));
  });

  // An app bound to an overlay brings it forward when it gets the focus, even
  // while the overlay is closed (its pinned panels follow).
  const activeApp = useActiveApp();
  const followApp = useRef<(app: string) => void>(() => undefined);
  followApp.current = (app) => {
    const target = overlays && overlayForApp(overlays, app);
    if (overlays && target && target.id !== overlays.active) {
      changeOverlays({ ...overlays, active: target.id });
    }
  };
  useEffect(() => {
    if (activeApp) followApp.current(activeApp);
  }, [activeApp]);

  const inOverlay = (id: PanelId) => layout !== null && id in layout;
  // Switching overlays leaves the full-screen panel of the previous one behind.
  const fullScreen = maximized !== null && inOverlay(maximized) ? maximized : null;
  const panel = (id: PanelId) => layout?.[id] ?? defaults(id);
  const summoned = visibility === 'summoned';
  // Pinned panels stay rendered while hidden (the window is unmapped then):
  // their rectangles are needed to bring them back at startup.
  const visible = (id: PanelId) => inOverlay(id) && (summoned || panel(id).pinned);
  // What the user actually sees (the window is unmapped while hidden).
  const onScreen = (id: PanelId) =>
    inOverlay(id) && (summoned || (visibility === 'pinned' && panel(id).pinned));

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

  // The overlay opens on the panels, whatever was open when it was closed.
  useEffect(() => {
    if (!summoned) setSettingsOpen(false);
  }, [summoned]);

  useEffect(() => {
    const tokens = themeTokens(settings.theme);
    applyTheme(tokens, document.documentElement);
    broadcastTheme(tokens);
  }, [settings.theme]);

  // Escape is handled by the core on the GTK window (it must also work while
  // a plugin's iframe has the focus, which this page cannot see).

  // A pinned panel gives the keyboard back as soon as the pointer leaves it.
  const onLeave = summoned ? undefined : () => void releaseKeyboard();
  // The panels of the active overlay: stacking compares them.
  const stack = (): Layout => layout ?? {};
  const raise = (id: PanelId) => {
    const all = stack();
    if (!isInFront(all, id)) updateLayout(id, { z: restack(all, id, 'front') });
  };
  const raiseRef = useRef(raise);
  raiseRef.current = raise;
  useWebPanelPresses((id) => raiseRef.current(id));

  const panelProps = (id: PanelId) => ({
    placement: panel(id).placement,
    pinned: panel(id).pinned,
    viewport,
    layer: layerOf(panel(id)),
    maximized: summoned && fullScreen === id,
    onToggleMaximize: () => setMaximized(fullScreen === id ? null : id),
    onTop: panel(id).onTop === true,
    onPlace: (placement: PanelLayout['placement']) => updateLayout(id, { placement }),
    onTogglePin: () => updateLayout(id, { pinned: !panel(id).pinned }),
    onPointerLeave: onLeave,
    onRaise: () => raise(id),
    onLayer: (action: LayerAction) => {
      if (action === 'toggle-on-top') {
        const onTop = panel(id).onTop !== true;
        // Joins the top of its new group.
        const all = { ...stack(), [id]: { ...panel(id), onTop } };
        updateLayout(id, { onTop, z: restack(all, id, 'front') });
      } else {
        updateLayout(id, { z: restack(stack(), id, action) });
      }
    },
    onClose: () => {
      if (fullScreen === id) setMaximized(null);
      if (overlays) commit(removePanel(overlays, id));
    },
  });

  // Every plugin's first instance stays loaded; other instances exist while
  // some overlay has them (ADR 0007).
  const used = overlays ? panelIdsIn(overlays) : new Set<string>();
  const instances = plugins.flatMap((plugin) => [
    { id: plugin.id, plugin },
    ...(plugin.panel.multiple
      ? [...used]
          .filter((id) => pluginOf(id) === plugin.id && instanceOf(id) > 1)
          .sort((a, b) => instanceOf(a) - instanceOf(b))
          .map((id) => ({ id, plugin }))
      : []),
  ]);
  // What "Add panel" offers: a missing panel, or another instance.
  const addable: { id: PanelId; name: string }[] = [
    ...(inOverlay('welcome') ? [] : [{ id: 'welcome', name: 'Overquid' }]),
    ...plugins.flatMap((plugin) => {
      if (!inOverlay(plugin.id)) return [{ id: plugin.id, name: plugin.name }];
      if (!plugin.panel.multiple) return [];
      const id = nextPanelId(plugin.id, used);
      return [{ id, name: panelTitle(plugin.name, id) }];
    }),
  ];

  return (
    <main className={summoned ? 'stage stage--summoned' : 'stage'}>
      {summoned && overlays && fullScreen === null && (
        <OverlayBar
          overlays={overlays.overlays}
          active={overlays.active}
          addable={addable}
          onSettings={() => setSettingsOpen((open) => !open)}
          onSwitch={(id) => changeOverlays({ ...overlays, active: id })}
          onCreate={() => changeOverlays(createOverlay(overlays))}
          onRename={(id, name) => commit(renameOverlay(overlays, id, name))}
          onDelete={(id) => changeOverlays(deleteOverlay(overlays, id))}
          activeApp={activeApp}
          onToggleApp={(id, app) => commit(toggleApp(overlays, id, app))}
          onAddPanel={(id) => {
            // In front of the panels already there.
            const z =
              Object.keys(stack()).length > 0
                ? restack({ ...stack(), [id]: defaults(id) }, id, 'front')
                : 0;
            commit(addPanels(overlays, { [id]: { ...defaults(id), z } }));
          }}
        />
      )}
      {summoned && settingsOpen && (
        <SettingsWindow
          settings={settings}
          update={updateSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
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
      {overlays !== null &&
        instances.map(({ id, plugin }) => {
          const [width, height] = plugin.panel.defaultSize ?? DEFAULT_PLUGIN_SIZE;
          const size = panel(id).size ?? { width, height };
          const title = panelTitle(plugin.name, id);
          return (
            <Panel
              key={id}
              title={title}
              width={size.width}
              contentHeight={size.height}
              onResize={(next, placement) => updateLayout(id, { size: next, placement })}
              hidden={!visible(id)}
              {...panelProps(id)}
            >
              {plugin.web?.browser ? (
                <Browser panelId={id} name={title} visible={onScreen(id)} />
              ) : plugin.web ? (
                <WebSlot panelId={id} name={title} visible={onScreen(id)} />
              ) : (
                <PluginFrame plugin={plugin} visible={onScreen(id)} />
              )}
            </Panel>
          );
        })}
    </main>
  );
}
