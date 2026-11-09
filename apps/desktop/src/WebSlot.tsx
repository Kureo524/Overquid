import { invoke } from '@tauri-apps/api/core';
import { useContext, useEffect, useLayoutEffect, useRef } from 'react';
import type { Rect } from './overlay';
import { PanelGeometry } from './Panel';

interface WebSlotProps {
  pluginId: string;
  name: string;
  /** Whether the panel is on screen: the native view is shown only then. */
  visible: boolean;
}

/**
 * Room for a web panel's native view (ADR 0004). The core draws the official
 * web app over this element: every render where its on-screen rectangle
 * changed (drag, resize, layout, visibility) sends the new one. The panel's
 * geometry is read so that this happens on every frame of a drag, not only
 * once the panel is dropped.
 */
export function WebSlot({ pluginId, name, visible }: WebSlotProps) {
  const ref = useRef<HTMLDivElement>(null);
  const sent = useRef<string | null>(null);
  useContext(PanelGeometry);

  useLayoutEffect(() => {
    const element = ref.current;
    const rect = visible && element ? layoutRect(element) : null;
    const key = JSON.stringify(rect);
    if (key === sent.current) return;
    sent.current = key;
    invoke('web_panel', { pluginId, rect }).catch((error: unknown) =>
      console.error(`Web panel ${pluginId}:`, error),
    );
  });

  useEffect(
    () => () => {
      void invoke('web_panel', { pluginId, rect: null });
    },
    [pluginId],
  );

  return (
    <div ref={ref} className="web-slot mono">
      Loading {name}…
    </div>
  );
}

/**
 * The element's rectangle in the page, ignoring CSS transforms: the overlay
 * zooms in when summoned, and `getBoundingClientRect` would catch the first
 * frame of that animation, leaving the native view slightly off for good.
 */
function layoutRect(element: HTMLElement): Rect {
  let x = 0;
  let y = 0;
  for (let node: Element | null = element; node instanceof HTMLElement; node = node.offsetParent) {
    x += node.offsetLeft + node.clientLeft;
    y += node.offsetTop + node.clientTop;
  }
  // The element's own border is outside the area the view covers.
  x -= element.clientLeft;
  y -= element.clientTop;
  return { x, y, width: element.offsetWidth, height: element.offsetHeight };
}
