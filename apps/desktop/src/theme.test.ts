import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, hexToHsl, hslToHex, safeTheme, themeTokens } from './theme';

describe('colours', () => {
  it('converts to HSL and back', () => {
    for (const hex of ['#8fa4cc', '#0b0c11', '#cf9bb3', '#000000', '#ffffff']) {
      const back = hslToHex(hexToHsl(hex));
      // Rounded to whole HSL units: within a few steps per channel.
      const diff = Number.parseInt(hex.slice(1, 3), 16) - Number.parseInt(back.slice(1, 3), 16);
      expect(Math.abs(diff)).toBeLessThanOrEqual(3);
    }
  });
});

describe('themes', () => {
  it('gives the design tokens for the default theme', () => {
    const tokens = themeTokens(DEFAULT_THEME);
    expect(tokens['--accent']).toBe('#8fa4cc');
    expect(tokens['--accent-soft']).toBe('rgba(143, 164, 204, 0.14)');
    expect(tokens['--veil']).toBe('rgba(11, 12, 17, 0.38)');
    expect(tokens['--glass']).toBe('rgba(20, 22, 30, 0.72)');
    expect(tokens['--surface']).toBe('rgba(16, 18, 25, 0.84)');
  });

  it('keeps accents readable and inks dark', () => {
    const safe = safeTheme({ accent: '#101010', ink: '#ffffff', glass: 0.1, veil: 5 });
    expect(hexToHsl(safe.accent).l).toBeGreaterThanOrEqual(54);
    expect(hexToHsl(safe.ink).l).toBeLessThanOrEqual(12);
    expect(safe.glass).toBe(0.6);
    expect(safe.veil).toBe(0.8);
  });

  it('leaves valid colours untouched', () => {
    expect(safeTheme(DEFAULT_THEME)).toEqual(DEFAULT_THEME);
  });
});
