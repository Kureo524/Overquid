import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const { duplicateShortcut, shortcutLabel, shortcutOf } = await import('./shortcuts');

const press = (
  key: string,
  mods: Partial<Record<'ctrl' | 'shift' | 'alt' | 'meta', boolean>> = {},
) => ({
  key,
  ctrlKey: mods.ctrl ?? false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
  metaKey: mods.meta ?? false,
});

describe('shortcutOf', () => {
  it('names a key press in the order the core reads', () => {
    expect(shortcutOf(press('x', { alt: true, shift: true }))).toBe('Shift+Alt+X');
    expect(shortcutOf(press('F5'))).toBe('F5');
    expect(shortcutOf(press(',', { ctrl: true }))).toBe('Ctrl+comma');
    expect(shortcutOf(press('Enter', { meta: true }))).toBe('Super+Return');
    expect(shortcutOf(press(' '))).toBe('space');
  });

  it('waits for a real key', () => {
    expect(shortcutOf(press('Control', { ctrl: true }))).toBeNull();
    expect(shortcutOf(press('Shift', { shift: true }))).toBeNull();
    expect(shortcutOf(press('Dead'))).toBeNull();
  });
});

describe('shortcuts', () => {
  it('shows symbols instead of key names', () => {
    expect(shortcutLabel('Ctrl+comma')).toBe('Ctrl + ,');
    expect(shortcutLabel('Super+Return')).toBe('Super + Enter');
    expect(shortcutLabel('space')).toBe('Space');
  });

  it('finds a shortcut used twice, and ignores empty ones', () => {
    const base = { toggle: null, close: 'Escape', next: '', prev: '', settings: '' };
    expect(duplicateShortcut(base)).toBeNull();
    expect(duplicateShortcut({ ...base, next: 'Ctrl+Tab', prev: 'Ctrl+Tab' })).toBe('Ctrl+Tab');
  });
});
