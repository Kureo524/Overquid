import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';

export type OverlayMode = 'layer-shell' | 'fallback';
export type Visibility = 'hidden' | 'summoned' | 'pinned';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Status {
  mode: OverlayMode;
  visibility: Visibility;
}

/** Overlay mode and visibility, kept in sync with the Rust core. */
export function useOverlayStatus(): { mode: OverlayMode | null; visibility: Visibility } {
  const [mode, setMode] = useState<OverlayMode | null>(null);
  const [visibility, setVisibility] = useState<Visibility>('hidden');

  useEffect(() => {
    let active = true;
    const unlisten = listen<Visibility>('overlay-state', (event) => setVisibility(event.payload));
    invoke<Status>('overlay_status').then(
      (status) => {
        if (!active) return;
        setMode(status.mode);
        setVisibility(status.visibility);
      },
      () => undefined,
    );
    return () => {
      active = false;
      void unlisten.then((stop) => stop());
    };
  }, []);

  return { mode, visibility };
}

export const dismissOverlay = () => invoke('dismiss_overlay');
export const releaseKeyboard = () => invoke('release_keyboard');
export const setPinnedRegions = (rects: Rect[]) => invoke('set_pinned_regions', { rects });

/** Rectangles of the given elements, rounded to whole CSS pixels. */
export function regionsOf(elements: Iterable<Element>): Rect[] {
  return Array.from(elements, (element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  });
}

export function sameRegions(a: Rect[], b: Rect[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (rect, i) =>
        rect.x === b[i]?.x &&
        rect.y === b[i]?.y &&
        rect.width === b[i]?.width &&
        rect.height === b[i]?.height,
    )
  );
}
