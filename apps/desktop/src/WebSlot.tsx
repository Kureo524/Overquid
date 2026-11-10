import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { geometryChanged, holesAbove, layoutRect, onGeometryChange } from './geometry';
import { instanceOf } from './instances';
import { edgeGradient, sameEdges, type PageEdges } from './webEdges';

interface WebSlotProps {
  /** The panel: the plugin's id, or `plugin#n` for another instance (ADR 0007). */
  panelId: string;
  name: string;
  /** Whether the panel is on screen: the native view is shown only then. */
  visible: boolean;
}

/**
 * Room for a web panel's native view (ADR 0004). The core draws the web page
 * over this element, minus the parts covered by panels in front of it. Both
 * are measured again whenever anything on screen moves.
 */
export function WebSlot({ panelId, name, visible }: WebSlotProps) {
  const ref = useRef<HTMLDivElement>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const sent = useRef<string | null>(null);

  useEffect(() => {
    const place = () => {
      const element = ref.current;
      const shown = visibleRef.current && element !== null;
      const rect = shown ? layoutRect(element) : null;
      const holes = shown ? holesAbove(element) : [];
      const key = JSON.stringify([rect, holes]);
      if (key === sent.current) return;
      sent.current = key;
      invoke('web_panel', { panelId, rect, holes }).catch((error: unknown) =>
        console.error(`Web panel ${panelId}:`, error),
      );
    };
    place();
    const stop = onGeometryChange(place);
    return () => {
      stop();
      sent.current = null;
      // Another instance is gone for good: destroy its page. The first one
      // only hides, as plugin panels stay loaded.
      if (instanceOf(panelId) > 1) void invoke('web_panel_close', { panelId });
      else void invoke('web_panel', { panelId, rect: null, holes: [] });
    };
  }, [panelId]);

  const [edges, setEdges] = useState<PageEdges | null>(null);
  useEffect(() => {
    const stop = listen<PageEdges>('web-panel-edges', ({ payload }) => {
      if (payload.panelId !== panelId) return;
      setEdges((known) => (known && sameEdges(known, payload) ? known : payload));
    });
    return () => void stop.then((unlisten) => unlisten());
  }, [panelId]);

  // Own changes (visibility) count as a move too.
  useLayoutEffect(() => geometryChanged());

  return (
    <div ref={ref} className="web-slot mono">
      Loading {name}…
      {edges && (
        <>
          <span
            className="web-edge web-edge--top"
            style={{ background: edgeGradient('to right', edges.top, 16) }}
          />
          <span
            className="web-edge web-edge--bottom"
            style={{ background: edgeGradient('to right', edges.bottom, 16) }}
          />
          <span
            className="web-edge web-edge--left"
            style={{ background: edgeGradient('to bottom', edges.left, 0) }}
          />
          <span
            className="web-edge web-edge--right"
            style={{ background: edgeGradient('to bottom', edges.right, 0) }}
          />
        </>
      )}
    </div>
  );
}
