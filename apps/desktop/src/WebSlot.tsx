import { invoke } from '@tauri-apps/api/core';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { geometryChanged, holesAbove, layoutRect, onGeometryChange } from './geometry';
import { instanceOf } from './instances';

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

  // Own changes (visibility) count as a move too.
  useLayoutEffect(() => geometryChanged());

  return (
    <div ref={ref} className="web-slot mono">
      Loading {name}…
    </div>
  );
}
