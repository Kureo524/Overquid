import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

const { DEFAULT_SETTINGS, parseSettings, serializeSettings } = await import('./settings');

describe('settings', () => {
  it('falls back to the defaults', () => {
    for (const value of [null, undefined, 3, [], {}, { theme: 'x' }]) {
      expect(parseSettings(value)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('keeps valid values and drops malformed ones', () => {
    const parsed = parseSettings({
      theme: { accent: '#cf9bb3', ink: 'red', glass: 0.7, veil: '1' },
    });
    expect(parsed.theme).toEqual({ ...DEFAULT_SETTINGS.theme, accent: '#cf9bb3', glass: 0.7 });
  });

  it('reads the snap settings', () => {
    expect(parseSettings({ snap: { mode: 'always', key: 'Alt' } }).snap).toEqual({
      mode: 'always',
      key: 'Alt',
    });
    expect(parseSettings({ snap: { mode: 'x', key: 3 } }).snap).toEqual(DEFAULT_SETTINGS.snap);
  });

  it('round-trips', () => {
    expect(parseSettings(serializeSettings(DEFAULT_SETTINGS))).toEqual(DEFAULT_SETTINGS);
  });
});
