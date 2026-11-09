import { invoke } from '@tauri-apps/api/core';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Rect } from './overlay';

interface WebSlotProps {
  pluginId: string;
  name: string;
  height: number;
  /** Whether the panel is on screen: the native view is shown only then. */
  visible: boolean;
}

/**
 * Room for a web panel's native view (ADR 0004). The core draws the official
 * web app over this element: every render where its on-screen rectangle
 * changed (drag, layout, visibility) sends the new one.
 */
export function WebSlot({ pluginId, name, height, visible }: WebSlotProps) {
  const ref = useRef<HTMLDivElement>(null);
  const sent = useRef<string | null>(null);

  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    const rect: Rect | null =
      visible && box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
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
    <div ref={ref} className="web-slot mono" style={{ height }}>
      Loading {name}…
    </div>
  );
}
