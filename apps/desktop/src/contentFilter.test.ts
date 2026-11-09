import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

const { describeFilter, isExcepted, siteOf } = await import('./contentFilter');

describe('siteOf', () => {
  it('keeps the host without www, for web pages only', () => {
    expect(siteOf('https://www.YouTube.com/watch?v=1')).toBe('youtube.com');
    expect(siteOf('http://m.example.org:8080/a')).toBe('m.example.org');
    expect(siteOf('about:blank')).toBeNull();
    expect(siteOf('not a url')).toBeNull();
  });
});

describe('isExcepted', () => {
  it('covers a site and its subdomains, nothing else', () => {
    expect(isExcepted('youtube.com', ['youtube.com'])).toBe(true);
    expect(isExcepted('music.youtube.com', ['youtube.com'])).toBe(true);
    expect(isExcepted('notyoutube.com', ['youtube.com'])).toBe(false);
    expect(isExcepted('youtube.com', [])).toBe(false);
  });
});

describe('describeFilter', () => {
  it('says what the filter is doing', () => {
    expect(describeFilter({ state: 'on', lists: 6, scriptlets: 153 })).toBe(
      'On: 6 lists, 153 scriptlets',
    );
    expect(describeFilter({ state: 'error', message: 'offline' })).toBe('Error: offline');
  });
});
