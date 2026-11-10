import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_THEME, isHex, type Theme } from '../theme';

/** What `settings.json` holds. Anything missing or malformed takes its default. */
export interface Settings {
  theme: Theme;
  snap: SnapSettings;
}

/** When panels stick to each other and to the screen while moved or resized. */
export type SnapMode = 'hold' | 'always' | 'off';

/** A modifier, as `KeyboardEvent.getModifierState` names it. */
export type Modifier = 'Control' | 'Shift' | 'Alt' | 'Meta';

export const MODIFIERS: Modifier[] = ['Control', 'Shift', 'Alt', 'Meta'];

export interface SnapSettings {
  mode: SnapMode;
  /** With `hold`, the key that turns snapping on. */
  key: Modifier;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: DEFAULT_THEME,
  snap: { mode: 'hold', key: 'Control' },
};

export const SETTINGS_VERSION = 1;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const numberOr = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function parseTheme(value: unknown): Theme {
  const theme = isRecord(value) ? value : {};
  return {
    accent: isHex(theme.accent) ? theme.accent : DEFAULT_THEME.accent,
    ink: isHex(theme.ink) ? theme.ink : DEFAULT_THEME.ink,
    glass: numberOr(theme.glass, DEFAULT_THEME.glass),
    veil: numberOr(theme.veil, DEFAULT_THEME.veil),
  };
}

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

function parseSnap(value: unknown): SnapSettings {
  const snap = isRecord(value) ? value : {};
  const fallback = DEFAULT_SETTINGS.snap;
  return {
    mode: oneOf(snap.mode, ['hold', 'always', 'off'], fallback.mode),
    key: oneOf(snap.key, MODIFIERS, fallback.key),
  };
}

export function parseSettings(value: unknown): Settings {
  const saved = isRecord(value) ? value : {};
  return { theme: parseTheme(saved.theme), snap: parseSnap(saved.snap) };
}

export const serializeSettings = (settings: Settings) => ({
  version: SETTINGS_VERSION,
  ...settings,
});

/** Delay before saving: a slider being dragged only writes once. */
const SAVE_DELAY = 300;

export type UpdateSettings = (change: (current: Settings) => Settings) => void;

/** The settings (defaults until loaded), and a setter that also saves them. */
export function useSettings(): [Settings, UpdateSettings] {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const latest = useRef(DEFAULT_SETTINGS);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let active = true;
    invoke<unknown>('load_settings').then(
      (saved) => {
        if (!active) return;
        latest.current = parseSettings(saved);
        setSettings(latest.current);
      },
      (error: unknown) => console.error('Cannot load the settings:', error),
    );
    return () => {
      active = false;
    };
  }, []);

  const update = useCallback<UpdateSettings>((change) => {
    latest.current = change(latest.current);
    setSettings(latest.current);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      invoke('save_settings', { settings: serializeSettings(latest.current) }).catch(
        (error: unknown) => console.error('Cannot save the settings:', error),
      );
    }, SAVE_DELAY);
  }, []);

  return [settings, update];
}
