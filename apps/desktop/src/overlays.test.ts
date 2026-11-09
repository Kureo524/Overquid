import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const {
  activeOverlay,
  addPanels,
  createOverlay,
  cycle,
  deleteOverlay,
  parseOverlays,
  removePanel,
  renameOverlay,
  serializeOverlays,
  switchByName,
  updatePanel,
} = await import('./overlays');

const panel = (dx: number) =>
  ({ placement: { h: 'left', v: 'top', dx, dy: 0 }, pinned: false }) as const;

const two = {
  active: 'main',
  overlays: [
    { id: 'main', name: 'Main', panels: { clock: panel(1) } },
    { id: 'work', name: 'Work', panels: { browser: panel(2) } },
  ],
};

describe('parseOverlays', () => {
  it('reads what serializeOverlays writes', () => {
    const value = JSON.parse(JSON.stringify(serializeOverlays(two))) as unknown;
    expect(parseOverlays(value)).toEqual({ overlays: two, fillWithInstalled: false });
  });

  it('turns a one-layout file into the Main overlay, to be filled', () => {
    const v1 = { version: 1, panels: { clock: panel(5) } };
    expect(parseOverlays(v1)).toEqual({
      overlays: {
        active: 'main',
        overlays: [{ id: 'main', name: 'Main', panels: { 'dev.overquid.clock': panel(5) } }],
      },
      fillWithInstalled: true,
    });
  });

  it('starts with an empty Main overlay when nothing is saved', () => {
    expect(parseOverlays(null).overlays.overlays).toEqual([
      { id: 'main', name: 'Main', panels: {} },
    ]);
  });

  it('drops broken and duplicate overlays, and an unknown active one', () => {
    const value = {
      version: 2,
      active: 'gone',
      overlays: [
        { id: 'a', name: ' A ', panels: { x: panel(1), bad: { placement: 'no' } } },
        { id: 'a', name: 'Again', panels: {} },
        { id: 3, name: 'Number id' },
        'nope',
      ],
    };
    expect(parseOverlays(value).overlays).toEqual({
      active: 'a',
      overlays: [{ id: 'a', name: 'A', panels: { x: panel(1) } }],
    });
  });
});

describe('switching', () => {
  it('cycles forward and backward, wrapping around', () => {
    expect(cycle(two, 1).active).toBe('work');
    expect(cycle(cycle(two, 1), 1).active).toBe('main');
    expect(cycle(two, -1).active).toBe('work');
  });

  it('switches by name, ignoring case and spaces', () => {
    expect(switchByName(two, ' work ').active).toBe('work');
    expect(switchByName(two, 'nothing')).toBe(two);
  });
});

describe('editing overlays', () => {
  it('creates uniquely named overlays and activates them', () => {
    const one = createOverlay(two);
    expect(activeOverlay(one)).toEqual({ id: 'overlay-3', name: 'Overlay 3', panels: {} });
    const again = createOverlay(renameOverlay(one, 'work', 'Overlay 4'));
    expect(activeOverlay(again).name).toBe('Overlay 5');
  });

  it('renames, but never to an empty name', () => {
    expect(renameOverlay(two, 'work', ' Jeu ').overlays[1]?.name).toBe('Jeu');
    expect(renameOverlay(two, 'work', '  ')).toBe(two);
  });

  it('deletes an overlay but never the last one', () => {
    const deleted = deleteOverlay(two, 'main');
    expect(deleted).toEqual({ active: 'work', overlays: [two.overlays[1]] });
    expect(deleteOverlay(deleted, 'work')).toBe(deleted);
    expect(deleteOverlay(two, 'work').active).toBe('main');
  });
});

describe('panels of the active overlay', () => {
  it('adds, changes and removes panels of the active overlay only', () => {
    const added = addPanels(two, { browser: panel(9) });
    expect(activeOverlay(added).panels).toEqual({ clock: panel(1), browser: panel(9) });
    expect(added.overlays[1]).toBe(two.overlays[1]);

    const moved = updatePanel(added, 'clock', { pinned: true }, panel(0));
    expect(activeOverlay(moved).panels.clock).toEqual({ ...panel(1), pinned: true });

    expect(activeOverlay(removePanel(moved, 'clock')).panels).toEqual({ browser: panel(9) });
  });

  it('keeps a panel already there when adding it again', () => {
    expect(activeOverlay(addPanels(two, { clock: panel(7) })).panels.clock).toEqual(panel(1));
  });
});
