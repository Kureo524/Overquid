import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

type OverlayMode = 'layer-shell' | 'fallback';

const modeLabel: Record<OverlayMode, string> = {
  'layer-shell': 'Wayland layer-shell',
  fallback: 'Always-on-top window',
};

export function App() {
  const [mode, setMode] = useState<OverlayMode | null>(null);

  useEffect(() => {
    invoke<OverlayMode>('overlay_mode').then(setMode, () => setMode(null));

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void invoke('hide_overlay');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <main className="veil">
      <section className="glass panel" aria-label="Overquid">
        <header className="panel__bar">
          <span className="panel__title">Overquid</span>
          <span className="mono">{mode ? modeLabel[mode] : '…'}</span>
        </header>
        <div className="panel__body">
          <p>Overlay spike. Plugins will live in panels like this one.</p>
          <dl className="keys">
            <dt>
              <kbd>Esc</kbd>
            </dt>
            <dd>Hide the overlay</dd>
            <dt>
              <kbd>overquid toggle</kbd>
            </dt>
            <dd>Show or hide from any hotkey</dd>
          </dl>
        </div>
      </section>
    </main>
  );
}
