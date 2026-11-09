import { describe, expect, it } from 'vitest';
import { instanceOf, nextPanelId, panelIdsIn, panelTitle, pluginOf } from './instances';

const panel = { placement: { h: 'left', v: 'top', dx: 0, dy: 0 }, pinned: false } as const;

describe('panel ids', () => {
  it('reads the plugin and the instance', () => {
    expect(pluginOf('dev.overquid.browser')).toBe('dev.overquid.browser');
    expect(pluginOf('dev.overquid.browser#3')).toBe('dev.overquid.browser');
    expect(instanceOf('dev.overquid.browser')).toBe(1);
    expect(instanceOf('dev.overquid.browser#3')).toBe(3);
    expect(instanceOf('dev.overquid.browser#x')).toBe(1);
  });

  it('gives the first free id', () => {
    const browser = 'dev.overquid.browser';
    expect(nextPanelId(browser, new Set())).toBe(browser);
    expect(nextPanelId(browser, new Set([browser]))).toBe(`${browser}#2`);
    expect(nextPanelId(browser, new Set([browser, `${browser}#3`]))).toBe(`${browser}#2`);
  });

  it('titles instances after the first one with their number', () => {
    expect(panelTitle('Browser', 'dev.overquid.browser')).toBe('Browser');
    expect(panelTitle('Browser', 'dev.overquid.browser#2')).toBe('Browser 2');
  });

  it('collects the panels of every overlay', () => {
    const state = {
      active: 'a',
      overlays: [
        { id: 'a', name: 'A', panels: { x: panel } },
        { id: 'b', name: 'B', panels: { 'x#2': panel, y: panel } },
      ],
    };
    expect([...panelIdsIn(state)].sort()).toEqual(['x', 'x#2', 'y']);
  });
});
