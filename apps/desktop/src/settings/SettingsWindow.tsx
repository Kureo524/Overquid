import { useLayoutEffect, useState } from 'react';
import { geometryChanged } from '../geometry';
import { Appearance } from './Appearance';
import { General } from './General';
import { ShortcutsSection } from './Shortcuts';
import type { Settings, UpdateSettings } from './settings';

/** In front of the panels and the overlay bar, behind menus. */
export const SETTINGS_LAYER = 1_800_000;

const TABS = ['General', 'Appearance', 'Shortcuts'] as const;
type Tab = (typeof TABS)[number];

interface SettingsWindowProps {
  settings: Settings;
  update: UpdateSettings;
  onClose: () => void;
}

export function SettingsWindow({ settings, update, onClose }: SettingsWindowProps) {
  const [tab, setTab] = useState<Tab>('General');

  // Web panels under the window are cut where it is.
  useLayoutEffect(() => {
    geometryChanged();
    return () => geometryChanged();
  }, []);

  return (
    <section
      className="glass settings"
      role="dialog"
      aria-label="Settings"
      style={{ zIndex: SETTINGS_LAYER }}
      data-layer={SETTINGS_LAYER}
    >
      <nav className="settings__nav" role="tablist" aria-orientation="vertical">
        <h1 className="settings__title">Settings</h1>
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            className="settings__tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </nav>
      <div className="settings__content" role="tabpanel" aria-label={tab}>
        <button
          type="button"
          className="icon-button settings__close"
          aria-label="Close settings"
          title="Close"
          onClick={onClose}
        >
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          >
            <path d="m4.5 4.5 7 7m0-7-7 7" />
          </svg>
        </button>
        {tab === 'General' && (
          <General
            snap={settings.snap}
            onSnap={(snap) => update((current) => ({ ...current, snap }))}
          />
        )}
        {tab === 'Appearance' && (
          <Appearance
            theme={settings.theme}
            onChange={(theme) => update((current) => ({ ...current, theme }))}
          />
        )}
        {tab === 'Shortcuts' && (
          <ShortcutsSection
            shortcuts={settings.shortcuts}
            snap={settings.snap}
            onShortcuts={(shortcuts) => update((current) => ({ ...current, shortcuts }))}
            onSnap={(snap) => update((current) => ({ ...current, snap }))}
          />
        )}
      </div>
    </section>
  );
}
