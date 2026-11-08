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

    // Hide on key *release*: hiding on keydown unmaps the window before the
    // release arrives, WebKitGTK then believes Escape is still held and drops
    // the next press after the overlay is shown again.
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void invoke('hide_overlay');
    };
    window.addEventListener('keyup', onKeyUp);
    return () => window.removeEventListener('keyup', onKeyUp);
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
