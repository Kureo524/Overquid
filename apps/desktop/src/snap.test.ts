import { describe, expect, it } from 'vitest';
import { SNAP_GAP, snapMove, snapResize } from './snap';

const screen = { width: 1000, height: 800 };
const min = { width: 100, height: 100 };
const box = (x: number, y: number, width = 200, height = 100) => ({ x, y, width, height });

describe('snapMove', () => {
  it('leaves a panel alone far from any line', () => {
    expect(snapMove(box(211, 333), [], screen)).toEqual({ box: box(211, 333), guides: [] });
  });

  it('sticks to the screen edges, its margin and its centre', () => {
    expect(snapMove(box(4, 333), [], screen).box.x).toBe(0);
    expect(snapMove(box(16, 333), [], screen).box.x).toBe(SNAP_GAP);
    expect(snapMove(box(795, 333), [], screen).box.x).toBe(800);
    expect(snapMove(box(404, 333), [], screen)).toEqual({
      box: box(400, 333),
      guides: [{ axis: 'x', at: 500 }],
    });
    expect(snapMove(box(211, 345), [], screen).box.y).toBe(350);
  });

  it('aligns with other panels and leaves a gap beside them', () => {
    const other = box(600, 200, 200, 300);
    expect(snapMove(box(595, 700), [other], screen).box.x).toBe(600);
    const beside = snapMove(box(380, 90), [other], screen);
    expect(beside.box.x).toBe(600 - 200 - SNAP_GAP);
    expect(beside.guides).toContainEqual({ axis: 'x', at: 600 });
  });

  it('prefers the closest line', () => {
    expect(snapMove(box(3, 333), [], screen).box.x).toBe(0);
    expect(snapMove(box(9, 333), [], screen).box.x).toBe(SNAP_GAP);
  });
});

describe('snapResize', () => {
  it('only moves the dragged side', () => {
    const { box: result, guides } = snapResize(box(100, 100, 395, 200), 'e', [], min, screen);
    expect(result).toEqual(box(100, 100, 400, 200));
    expect(guides).toEqual([{ axis: 'x', at: 500 }]);
  });

  it('keeps the opposite side when the left or top side snaps', () => {
    const result = snapResize(box(504, 100, 200, 200), 'w', [], min, screen).box;
    expect(result.x).toBe(500);
    expect(result.x + result.width).toBe(704);
  });

  it('snaps next to another panel, with the gap', () => {
    const other = box(600, 100, 200, 300);
    const result = snapResize(box(100, 100, 490, 200), 'e', [other], min, screen).box;
    expect(result.x + result.width).toBe(600 - SNAP_GAP);
  });

  it('does not go below the minimum size', () => {
    const result = snapResize(box(100, 100, 105, 200), 'e', [box(190, 500)], min, screen).box;
    expect(result.width).toBeGreaterThanOrEqual(100);
  });
});
