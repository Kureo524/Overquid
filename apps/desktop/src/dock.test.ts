import { describe, expect, it } from 'vitest';
import { clipAround } from './dock';

describe('clipAround', () => {
  const own = { x: 100, y: 50, width: 400, height: 300 };

  it("cuts a hole in the element's own coordinates", () => {
    expect(clipAround(own, [{ x: 120, y: 90, width: 200, height: 100 }])).toBe(
      'path(evenodd, "M-100000 -100000H100000V100000H-100000ZM20 40h200v100h-200Z")',
    );
  });

  it('cuts several holes at once', () => {
    const clip = clipAround(own, [
      { x: 120, y: 90, width: 200, height: 100 },
      { x: 0, y: 0, width: 50, height: 50 },
    ]);
    expect(clip).toContain('M20 40h200v100h-200Z');
    expect(clip).toContain('M-100 -50h50v50h-50Z');
  });
});
