import { describe, expect, it } from 'vitest';
import { treemap } from './treemap';

const area = { x: 10, y: 20, width: 600, height: 400 };
const size = (value: number) => value;

describe('treemap', () => {
  it('gives each item an area in proportion to its size', () => {
    const placed = treemap([60, 30, 10], size, area);
    const total = 600 * 400;
    expect(placed).toHaveLength(3);
    for (const { item, width, height } of placed) {
      expect(width * height).toBeCloseTo((item / 100) * total, 3);
    }
  });

  it('fills the area without overlap or overflow', () => {
    const placed = treemap([50, 25, 12, 6, 4, 2, 1], size, area);
    const covered = placed.reduce((acc, rect) => acc + rect.width * rect.height, 0);
    expect(covered).toBeCloseTo(600 * 400, 3);
    for (const rect of placed) {
      expect(rect.x).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(rect.y).toBeGreaterThanOrEqual(20 - 1e-6);
      expect(rect.x + rect.width).toBeLessThanOrEqual(610 + 1e-6);
      expect(rect.y + rect.height).toBeLessThanOrEqual(420 + 1e-6);
    }
    for (const [i, a] of placed.entries()) {
      for (const b of placed.slice(i + 1)) {
        const overlaps =
          a.x + a.width - 1e-6 > b.x &&
          b.x + b.width - 1e-6 > a.x &&
          a.y + a.height - 1e-6 > b.y &&
          b.y + b.height - 1e-6 > a.y;
        expect(overlaps).toBe(false);
      }
    }
  });

  it('keeps rectangles reasonably square', () => {
    const placed = treemap([30, 25, 20, 15, 10], size, area);
    for (const { width, height } of placed) {
      expect(Math.max(width / height, height / width)).toBeLessThan(3);
    }
  });

  it('leaves out empty items and handles nothing to show', () => {
    expect(treemap([0, 5], size, area)).toHaveLength(1);
    expect(treemap([0], size, area)).toEqual([]);
    expect(treemap([], size, area)).toEqual([]);
    expect(treemap([5], size, { ...area, width: 0 })).toEqual([]);
  });
});
