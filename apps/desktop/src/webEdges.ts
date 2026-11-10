/** The colours along each edge of a web page, read by the core. */
export interface PageEdges {
  panelId: string;
  top: string[];
  right: string[];
  bottom: string[];
  left: string[];
}

export const sameEdges = (a: PageEdges, b: PageEdges) =>
  (['top', 'right', 'bottom', 'left'] as const).every((side) => a[side].join() === b[side].join());

/**
 * CSS gradient following a page's edge. `overhang` is how many pixels the
 * element reaches past the page at each end: colours stay facing the part of
 * the page they were read from.
 */
export function edgeGradient(
  direction: 'to right' | 'to bottom',
  colors: string[],
  overhang: number,
): string {
  const last = Math.max(colors.length - 1, 1);
  const stops = colors.map(
    (color, index) => `${color} calc(${overhang}px + (100% - ${2 * overhang}px) * ${index / last})`,
  );
  return `linear-gradient(${direction}, ${stops.join(', ')})`;
}
