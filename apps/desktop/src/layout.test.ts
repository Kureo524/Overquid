import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const { migrateLayout, parseLayout, serializeLayout, toPlacement, toPosition } =
  await import('./layout');

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
