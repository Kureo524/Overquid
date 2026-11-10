import { connect, type SpaceNode } from '@overquid/sdk';
import { treemap } from './treemap';
import './style.css';

const overquid = connect();

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Disk space: #${id} is missing`);
  return found as T;
}

const pathField = element<HTMLInputElement>('path');
const scanButton = element<HTMLButtonElement>('scan');
const upButton = element<HTMLButtonElement>('up');
const map = element('map');
const crumbs = element('crumbs');
const status = element('status');

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

function formatSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 || value >= 100 ? Math.round(value) : value.toFixed(1)} ${UNITS[unit]}`;
}

/** The folders from the scanned one down to the one shown. */
let trail: SpaceNode[] = [];

/** Tiles smaller than this are not drawn: they could not be read. */
const MIN_TILE = 4;
/** Lighter tiles for the biggest entries, always the single accent. */
const accentShare = (rank: number, count: number) =>
  Math.round(46 - (30 * rank) / Math.max(1, count));

function render() {
  const node = trail.at(-1);
  upButton.disabled = trail.length <= 1;
  crumbs.textContent = trail.map((part) => part.name).join(' › ');
  map.replaceChildren();
  if (!node) return;
  status.textContent = `${node.name}: ${formatSize(node.size)}`;
  const { width, height } = map.getBoundingClientRect();
  const items = [...node.children];
  // The children only list the largest entries: show what is left as one tile.
  const listed = items.reduce((acc, child) => acc + child.size, 0);
  const rest = node.size - listed;
  if (rest > 0) items.push({ name: 'Other files', size: rest, dir: false, children: [] });
  const tiles = treemap(items, (item) => item.size, { x: 0, y: 0, width, height });
  tiles.forEach(({ item, x, y, width: w, height: h }, rank) => {
    if (w < MIN_TILE || h < MIN_TILE) return;
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = item.children.length > 0 ? 'tile tile--dir' : 'tile';
    tile.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
    tile.style.setProperty('--share', `${accentShare(rank, tiles.length)}%`);
    tile.title = `${item.name}: ${formatSize(item.size)}`;
    if (w > 54 && h > 30) {
      const name = document.createElement('span');
      name.textContent = item.name;
      const size = document.createElement('span');
      size.className = 'tile__size';
      size.textContent = formatSize(item.size);
      tile.append(name, size);
    }
    if (item.children.length > 0) {
      tile.addEventListener('click', () => {
        trail = [...trail, item];
        render();
      });
    } else {
      tile.disabled = true;
    }
    map.append(tile);
  });
}

async function analyse() {
  const path = pathField.value.trim();
  if (!path) return;
  scanButton.disabled = true;
  status.textContent = 'Analysing… this can take a while on a large folder';
  map.replaceChildren();
  crumbs.textContent = '';
  try {
    const started = performance.now();
    trail = [await overquid.files.scan(path)];
    render();
    status.textContent += ` · ${((performance.now() - started) / 1000).toFixed(1)} s`;
    overquid.storage.set('path', path).catch(() => undefined);
  } catch (error) {
    trail = [];
    status.textContent = String(error).replace(/^.*Error: /, '');
  } finally {
    scanButton.disabled = false;
  }
}

scanButton.addEventListener('click', () => void analyse());
pathField.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') void analyse();
});
upButton.addEventListener('click', () => {
  trail = trail.slice(0, -1);
  render();
});
new ResizeObserver(render).observe(map);

const saved = await overquid.storage.get<string>('path').catch(() => undefined);
pathField.value = saved ?? (await overquid.files.home());
status.textContent = 'Press Analyse to see what takes up space.';
