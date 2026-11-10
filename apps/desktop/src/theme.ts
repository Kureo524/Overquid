/**
 * Colours of the overlay. Only hues change (docs/design/encre.md): the theme
 * stays dark, with one accent, and text keeps its contrast, so a colour that
 * would break that is brought back into range when applied.
 */
export interface Theme {
  /** The single accent colour, `#rrggbb`. */
  accent: string;
  /** The dark ink glass and veil are made from, `#rrggbb`. */
  ink: string;
  /** Opacity of the glass panels. */
  glass: number;
  /** Opacity of the veil over the desktop; 0 removes it. */
  veil: number;
}

export const DEFAULT_THEME: Theme = { accent: '#8fa4cc', ink: '#0b0c11', glass: 0.84, veil: 0.38 };

export const ACCENT_PRESETS = [
  { name: 'Ink', color: '#8fa4cc' },
  { name: 'Steel', color: '#8fb3c4' },
  { name: 'Sage', color: '#8fb5a0' },
  { name: 'Amber', color: '#c9a877' },
  { name: 'Rose', color: '#cf9bb3' },
  { name: 'Amethyst', color: '#a89ad1' },
];

export const INK_PRESETS = [
  { name: 'Ink', color: '#0b0c11' },
  { name: 'Graphite', color: '#101012' },
  { name: 'Pine', color: '#0a110f' },
  { name: 'Wine', color: '#140c0f' },
  { name: 'Plum', color: '#120d16' },
];

export const GLASS_RANGE = { min: 0.6, max: 1 };
export const VEIL_RANGE = { min: 0, max: 0.8 };
/** Lightness kept for each colour: readable accents, inks that stay dark. */
export const ACCENT_LIGHTNESS = { min: 55, max: 85 };
export const INK_LIGHTNESS = { min: 2, max: 12 };

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export const isHex = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Hue in degrees, saturation and lightness in percent. */
export function hexToHsl(hex: string): Hsl {
  const [r, g, b] = channels(hex).map((channel) => channel / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l: Math.round(l * 100) };
  const s = delta / (1 - Math.abs(2 * l - 1));
  const sector =
    max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return {
    h: Math.round((sector * 60 + 360) % 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const saturation = s / 100;
  const lightness = l / 100;
  const amplitude = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const value = lightness - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

const inRange = (value: number, { min, max }: { min: number; max: number }) =>
  Math.max(min, Math.min(value, max));

function withLightness(hex: string, range: { min: number; max: number }): string {
  const hsl = hexToHsl(hex);
  const l = inRange(hsl.l, range);
  return l === hsl.l ? hex.toLowerCase() : hslToHex({ ...hsl, l });
}

/** The theme with every colour brought into its allowed range. */
export function safeTheme(theme: Theme): Theme {
  return {
    accent: withLightness(theme.accent, ACCENT_LIGHTNESS),
    ink: withLightness(theme.ink, INK_LIGHTNESS),
    glass: inRange(theme.glass, GLASS_RANGE),
    veil: inRange(theme.veil, VEIL_RANGE),
  };
}

const rgba = ([r, g, b]: [number, number, number], alpha: number) =>
  `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 100) / 100})`;

const lift = ([r, g, b]: [number, number, number], by: [number, number, number]) =>
  [Math.min(255, r + by[0]), Math.min(255, g + by[1]), Math.min(255, b + by[2])] as [
    number,
    number,
    number,
  ];

/** The CSS custom properties of a theme (`docs/design/encre.md`, section 3). */
export function themeTokens(theme: Theme): Record<string, string> {
  const { accent, ink, glass, veil } = safeTheme(theme);
  const accentRgb = channels(accent);
  const inkRgb = channels(ink);
  const accentHsl = hexToHsl(accent);
  return {
    '--accent': accent,
    '--accent-text': hslToHex({ ...accentHsl, l: Math.min(90, accentHsl.l + 10) }),
    '--accent-soft': rgba(accentRgb, 0.14),
    '--accent-tint': rgba(accentRgb, 0.42),
    '--veil': rgba(inkRgb, veil),
    // The two thicknesses of glass sit a little above the ink.
    '--glass': rgba(lift(inkRgb, [9, 10, 13]), Math.max(0.5, glass - 0.12)),
    '--surface': rgba(lift(inkRgb, [5, 6, 8]), glass),
    '--input': rgba(inkRgb, 0.7),
    '--canvas': rgba(inkRgb, 0.8),
  };
}

/** Applies a theme to a document. */
export function applyTheme(tokens: Record<string, string>, root: HTMLElement): void {
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
}
