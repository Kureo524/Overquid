import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';

/** The focused app (`active_app::ActiveApp`): its window class. */
interface ActiveApp {
  class: string;
}

/** The window class of the focused app, as the core reports it (Hyprland only). */
export function useActiveApp(): string | null {
  const [app, setApp] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const stop = listen<ActiveApp>('active-app', (event) => setApp(event.payload.class));
    invoke<ActiveApp | null>('active_app').then(
      (current) => active && current && setApp(current.class),
      (error: unknown) => console.error('Cannot read the focused app:', error),
    );
    return () => {
      active = false;
      void stop.then((unlisten) => unlisten());
    };
  }, []);
  return app;
}

/** A readable name for a window class: `org.vinegarhq.Sober` → `Sober`. */
export const appLabel = (windowClass: string): string =>
  windowClass.split('.').filter(Boolean).pop() ?? windowClass;
