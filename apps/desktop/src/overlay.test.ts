import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

const { regionsOf, sameRegions } = await import('./overlay');

const element = (x: number, y: number, width: number, height: number) =>
  ({ getBoundingClientRect: () => ({ x, y, width, height }) }) as unknown as Element;

describe('regionsOf', () => {
  it('reads each element rectangle', () => {
    expect(regionsOf([element(10, 20, 300, 120), element(0, 0, 200, 80)])).toEqual([
      { x: 10, y: 20, width: 300, height: 120 },
      { x: 0, y: 0, width: 200, height: 80 },
    ]);
  });
});

describe('sameRegions', () => {
  const a = { x: 1, y: 2, width: 3, height: 4 };

  it('compares rectangles in order', () => {
    expect(sameRegions([a], [{ ...a }])).toBe(true);
    expect(sameRegions([], [])).toBe(true);
    expect(sameRegions([a], [])).toBe(false);
    expect(sameRegions([a], [{ ...a, x: 2 }])).toBe(false);
  });
});
