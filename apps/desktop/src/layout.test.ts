import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const {
  isInFront,
  layerOf,
  migrateLayout,
  restack,
  parseLayout,
  resizeBox,
  serializeLayout,
  toPlacement,
  toPosition,
} = await import('./layout');

const laptop = { width: 1920, height: 1080 };
const wide = { width: 2560, height: 1600 };
const clock = { width: 200, height: 96 };

describe('placement', () => {
  it('anchors a top-right panel to the top-right corner', () => {
    const placement = toPlacement({ x: 1704, y: 16 }, clock, laptop);
    expect(placement).toEqual({ h: 'right', v: 'top', dx: 16, dy: 16 });
    expect(toPosition(placement, clock, wide)).toEqual({ x: 2344, y: 16 });
  });

  it('keeps a centred panel centred', () => {
    const size = { width: 360, height: 180 };
    const placement = toPlacement({ x: 780, y: 450 }, size, laptop);
    expect(placement).toEqual({ h: 'center', v: 'center', dx: 0, dy: 0 });
    expect(toPosition(placement, size, wide)).toEqual({ x: 1100, y: 710 });
  });

  it('anchors a bottom-left panel to the bottom-left corner', () => {
    const placement = toPlacement({ x: 24, y: 964 }, clock, laptop);
    expect(placement).toEqual({ h: 'left', v: 'bottom', dx: 24, dy: 20 });
    expect(toPosition(placement, clock, wide)).toEqual({ x: 24, y: 1484 });
  });

  it('round-trips on the same screen', () => {
    for (const position of [
      { x: 0, y: 0 },
      { x: 900, y: 500 },
      { x: 1720, y: 984 },
    ]) {
      expect(toPosition(toPlacement(position, clock, laptop), clock, laptop)).toEqual(position);
    }
  });

  it('clamps a panel back on screen', () => {
    const offscreen = { h: 'left', v: 'top', dx: 5000, dy: -40 } as const;
    expect(toPosition(offscreen, clock, laptop)).toEqual({ x: 1720, y: 0 });
    const tooBig = { width: 3000, height: 100 };
    expect(toPosition({ h: 'right', v: 'top', dx: 0, dy: 0 }, tooBig, laptop).x).toBe(0);
  });
});

describe('parseLayout', () => {
  const clockLayout = {
    placement: { h: 'right', v: 'top', dx: 16, dy: 16 },
    pinned: true,
  } as const;

  it('reads what serializeLayout writes', () => {
    const layout = { clock: clockLayout };
    expect(parseLayout(JSON.parse(JSON.stringify(serializeLayout(layout))))).toEqual(layout);
  });

  it('keeps a resized panel size and drops an invalid one', () => {
    const value = {
      version: 1,
      panels: {
        sized: { ...clockLayout, size: { width: 640.4, height: 400 } },
        negative: { ...clockLayout, size: { width: -1, height: 400 } },
        text: { ...clockLayout, size: { width: '640', height: 400 } },
      },
    };
    expect(parseLayout(value)).toEqual({
      sized: { ...clockLayout, size: { width: 640, height: 400 } },
      negative: clockLayout,
      text: clockLayout,
    });
  });

  it('falls back to an empty layout on unknown input', () => {
    expect(parseLayout(null)).toEqual({});
    expect(parseLayout('nope')).toEqual({});
    expect(parseLayout({ version: 99, panels: { clock: clockLayout } })).toEqual({});
  });

  it('drops malformed panels and keeps the others', () => {
    const value = {
      version: 1,
      panels: {
        clock: clockLayout,
        bad: { placement: { h: 'up', v: 'top', dx: 0, dy: 0 } },
        nan: { placement: { h: 'left', v: 'top', dx: 'x', dy: 0 } },
        noPinned: { placement: { h: 'left', v: 'top', dx: 1, dy: 2 } },
      },
    };
    expect(parseLayout(value)).toEqual({
      clock: clockLayout,
      noPinned: { placement: { h: 'left', v: 'top', dx: 1, dy: 2 }, pinned: false },
    });
  });
});

describe('resizeBox', () => {
  const from = { x: 100, y: 100, width: 400, height: 300 };
  const min = { width: 160, height: 90 };

  it('moves only the dragged sides', () => {
    expect(resizeBox(from, 'e', 50, 999, min, laptop)).toEqual({ ...from, width: 450 });
    expect(resizeBox(from, 's', 999, 50, min, laptop)).toEqual({ ...from, height: 350 });
    expect(resizeBox(from, 'w', -50, 999, min, laptop)).toEqual({ ...from, x: 50, width: 450 });
    expect(resizeBox(from, 'n', 999, -50, min, laptop)).toEqual({ ...from, y: 50, height: 350 });
  });

  it('resizes both sides from a corner', () => {
    expect(resizeBox(from, 'nw', 20, 30, min, laptop)).toEqual({
      x: 120,
      y: 130,
      width: 380,
      height: 270,
    });
    expect(resizeBox(from, 'se', 20, 30, min, laptop)).toEqual({
      x: 100,
      y: 100,
      width: 420,
      height: 330,
    });
  });

  it('keeps the opposite side in place at the minimum size', () => {
    expect(resizeBox(from, 'w', 1000, 0, min, laptop)).toEqual({ ...from, x: 340, width: 160 });
    expect(resizeBox(from, 'n', 0, 1000, min, laptop)).toEqual({ ...from, y: 310, height: 90 });
  });

  it('stops at the screen edges', () => {
    expect(resizeBox(from, 'w', -1000, 0, min, laptop)).toEqual({ ...from, x: 0, width: 500 });
    expect(resizeBox(from, 'e', 5000, 0, min, laptop)).toEqual({ ...from, width: 1820 });
    expect(resizeBox(from, 'n', 0, -1000, min, laptop)).toEqual({ ...from, y: 0, height: 400 });
    expect(resizeBox(from, 's', 0, 5000, min, laptop)).toEqual({ ...from, height: 980 });
  });
});

describe('migrateLayout', () => {
  const saved = { placement: { h: 'left', v: 'top', dx: 18, dy: 18 }, pinned: true } as const;

  it('moves the built-in clock to the clock plugin', () => {
    expect(migrateLayout({ clock: saved })).toEqual({ 'dev.overquid.clock': saved });
  });

  it('keeps the plugin entry when both exist', () => {
    const plugin = { ...saved, pinned: false };
    expect(migrateLayout({ clock: saved, 'dev.overquid.clock': plugin })).toEqual({
      'dev.overquid.clock': plugin,
    });
  });
});

describe('stacking', () => {
  const at = (z?: number, onTop?: boolean) => ({
    placement: { h: 'left', v: 'top', dx: 0, dy: 0 } as const,
    pinned: false,
    ...(z === undefined ? {} : { z }),
    ...(onTop ? { onTop } : {}),
  });

  it('brings a panel in front of, or behind, the others', () => {
    const layout = { a: at(), b: at(3), c: at(-2) };
    expect(restack(layout, 'a', 'front')).toBe(4);
    expect(restack(layout, 'a', 'back')).toBe(-3);
    expect(isInFront(layout, 'b')).toBe(true);
    expect(isInFront(layout, 'a')).toBe(false);
  });

  it('keeps panels on top above the others, ordered among themselves', () => {
    const layout = { a: at(50), top: at(0, true), top2: at(1, true) };
    expect(layerOf(layout.top)).toBeGreaterThan(layerOf(layout.a));
    expect(restack(layout, 'top', 'front')).toBe(2);
    expect(isInFront(layout, 'a')).toBe(true);
  });

  it('reads the stacking back from a saved layout', () => {
    const value = { version: 1, panels: { a: { ...at(7, true) }, b: { ...at(), z: 'x' } } };
    expect(parseLayout(value)).toEqual({ a: at(7, true), b: at() });
  });
});
