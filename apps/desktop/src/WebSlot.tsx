import { invoke } from '@tauri-apps/api/core';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { geometryChanged, holesAbove, layoutRect, onGeometryChange } from './geometry';

interface WebSlotProps {
  pluginId: string;
  name: string;
  /** Whether the panel is on screen: the native view is shown only then. */
  visible: boolean;
}

/**
 * Room for a web panel's native view (ADR 0004). The core draws the web page
 * over this element, minus the parts covered by panels in front of it. Both
 * are measured again whenever anything on screen moves.
 */
export function WebSlot({ pluginId, name, visible }: WebSlotProps) {
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
      invoke('web_panel', { pluginId, rect, holes }).catch((error: unknown) =>
        console.error(`Web panel ${pluginId}:`, error),
      );
    };
    place();
    const stop = onGeometryChange(place);
    return () => {
      stop();
      sent.current = null;
      void invoke('web_panel', { pluginId, rect: null, holes: [] });
    };
  }, [pluginId]);

  // Own changes (visibility) count as a move too.
  useLayoutEffect(() => geometryChanged());

  return (
    <div ref={ref} className="web-slot mono">
      Loading {name}…
    </div>
  );
}
