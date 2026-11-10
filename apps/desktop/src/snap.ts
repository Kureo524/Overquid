import { resizeBox, type Box, type ResizeEdge, type Size } from './layout';

/** How close a side must be to a line to stick to it. */
export const SNAP_DISTANCE = 10;
/** Space left between two panels placed side by side (docs/design/encre.md). */
export const SNAP_GAP = 12;

/** A line a panel snapped to, drawn while the gesture lasts. */
export interface Guide {
  axis: 'x' | 'y';
  at: number;
}

interface Span {
  start: number;
  length: number;
}

const end = (span: Span) => span.start + span.length;
const middle = (span: Span) => span.start + span.length / 2;

type Part = 'start' | 'middle' | 'end';
/** Where a part of a panel may stick to, and where the guide is drawn. */
interface Line {
  part: Part;
  at: number;
  guide: number;
}

/** Lines of one axis: the screen, its margin and centre, and the other panels. */
function linesOn(others: Span[], length: number): Line[] {
  const line = (part: Part, at: number, guide = at): Line => ({ part, at, guide });
  return [
    line('start', 0),
    line('start', SNAP_GAP),
    line('middle', length / 2),
    line('end', length),
    line('end', length - SNAP_GAP),
    ...others.flatMap((other) => [
      line('start', other.start),
      line('start', end(other)),
      line('start', end(other) + SNAP_GAP, end(other)),
      line('middle', middle(other)),
      line('end', end(other)),
      line('end', other.start),
      line('end', other.start - SNAP_GAP, other.start),
    ]),
  ];
}

/** The smallest shift that puts one of `parts` of `span` on a line, within reach. */
function closestShift(
  span: Span,
  parts: Part[],
  lines: Line[],
): { shift: number; guides: number[] } | null {
  const position = (part: Part) =>
    part === 'start' ? span.start : part === 'end' ? end(span) : middle(span);
  let best: number | null = null;
  for (const line of lines) {
    if (!parts.includes(line.part)) continue;
    const shift = line.at - position(line.part);
    if (Math.abs(shift) <= SNAP_DISTANCE && (best === null || Math.abs(shift) < Math.abs(best))) {
      best = shift;
    }
  }
  if (best === null) return null;
  const shift = best;
  const guides = lines
    .filter(
      (line) => parts.includes(line.part) && Math.abs(line.at - position(line.part) - shift) < 0.5,
    )
    .map((line) => line.guide);
  return { shift, guides: [...new Set(guides)] };
}

const guidesOn = (axis: Guide['axis'], found: { guides: number[] } | null): Guide[] =>
  found ? found.guides.map((at) => ({ axis, at })) : [];

const across = (box: Box): Span => ({ start: box.x, length: box.width });
const down = (box: Box): Span => ({ start: box.y, length: box.height });

/** `box` moved so its sides or centre stick to the closest lines. */
export function snapMove(box: Box, others: Box[], viewport: Size): { box: Box; guides: Guide[] } {
  const parts: Part[] = ['start', 'middle', 'end'];
  const x = closestShift(across(box), parts, linesOn(others.map(across), viewport.width));
  const y = closestShift(down(box), parts, linesOn(others.map(down), viewport.height));
  return {
    box: {
      ...box,
      x: Math.round(box.x + (x?.shift ?? 0)),
      y: Math.round(box.y + (y?.shift ?? 0)),
    },
    guides: [...guidesOn('x', x), ...guidesOn('y', y)],
  };
}

/** `box`, just resized from `edge`, with the moving sides stuck to the closest lines. */
export function snapResize(
  box: Box,
  edge: ResizeEdge,
  others: Box[],
  min: Size,
  viewport: Size,
): { box: Box; guides: Guide[] } {
  const side = (first: string, last: string): Part | null =>
    edge.includes(first) ? 'start' : edge.includes(last) ? 'end' : null;
  const h = side('w', 'e');
  const v = side('n', 's');
  // A moving side may stop on the centre lines too.
  const sideLines = (part: Part, spans: Span[], length: number) =>
    linesOn(spans, length).map((line) => (line.part === 'middle' ? { ...line, part } : line));
  const x = h && closestShift(across(box), [h], sideLines(h, others.map(across), viewport.width));
  const y = v && closestShift(down(box), [v], sideLines(v, others.map(down), viewport.height));
  return {
    box: resizeBox(box, edge, x?.shift ?? 0, y?.shift ?? 0, min, viewport),
    guides: [...guidesOn('x', x), ...guidesOn('y', y)],
  };
}
