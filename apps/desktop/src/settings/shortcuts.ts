import { invoke } from '@tauri-apps/api/core';
import type { Shortcuts } from './settings';

/** Which desktop the global shortcut is set up in (`shortcuts::Desktop`). */
export type Desktop = 'hyprland' | 'gnome' | 'manual';

export const shortcutDesktop = () => invoke<Desktop>('shortcut_desktop');

/** Tells the core: it reads the shortcuts, and moves the global one. */
export function applyShortcuts(shortcuts: Shortcuts): void {
  invoke('set_shortcuts', { shortcuts }).catch((error: unknown) =>
    console.error('Cannot apply the shortcuts:', error),
  );
}

export const suspendShortcuts = (suspended: boolean) => invoke('suspend_shortcuts', { suspended });

/** XKB names of the keys `KeyboardEvent.key` calls something else. */
const XKB_NAMES: Record<string, string> = {
  ' ': 'space',
  Enter: 'Return',
  Backspace: 'BackSpace',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  PageUp: 'Page_Up',
  PageDown: 'Page_Down',
  ',': 'comma',
  '.': 'period',
  '/': 'slash',
  ';': 'semicolon',
  "'": 'apostrophe',
  '[': 'bracketleft',
  ']': 'bracketright',
  '\\': 'backslash',
  '-': 'minus',
  '=': 'equal',
  '`': 'grave',
};

const NAMED_KEYS = new Set(['Tab', 'Escape', 'Delete', 'Insert', 'Home', 'End']);

function xkbName(key: string): string | null {
  const known = XKB_NAMES[key];
  if (known) return known;
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase();
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key) || NAMED_KEYS.has(key)) return key;
  return null;
}

type KeyPress = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>;

/**
 * A key press as a shortcut (`Ctrl+Shift+X`). `null` while only modifiers are
 * held, or for a key the desktops cannot all name.
 */
export function shortcutOf(event: KeyPress): string | null {
  const key = xkbName(event.key);
  if (!key) return null;
  return [
    event.ctrlKey && 'Ctrl',
    event.shiftKey && 'Shift',
    event.altKey && 'Alt',
    event.metaKey && 'Super',
    key,
  ]
    .filter(Boolean)
    .join('+');
}

const SYMBOLS = new Map(Object.entries(XKB_NAMES).map(([symbol, name]) => [name, symbol]));
const LABELS: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
};

/** A shortcut as shown to the user. */
export function shortcutLabel(shortcut: string): string {
  return shortcut
    .split('+')
    .map((part) => {
      const symbol = SYMBOLS.get(part);
      return symbol === undefined ? part : (LABELS[symbol] ?? symbol);
    })
    .join(' + ');
}

/** The first shortcut used twice, if any. */
export function duplicateShortcut(shortcuts: Shortcuts): string | null {
  const used = [shortcuts.close, shortcuts.next, shortcuts.prev, shortcuts.settings].filter(
    Boolean,
  );
  return used.find((shortcut, index) => used.indexOf(shortcut) !== index) ?? null;
}
