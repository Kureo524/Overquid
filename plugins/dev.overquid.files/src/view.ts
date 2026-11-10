import type { FileEntry } from '@overquid/sdk';

export type SortKey = 'name' | 'size' | 'modified';

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Folders first, then by the chosen column. Hidden files are left out unless asked. */
export function arrange(
  entries: FileEntry[],
  sort: SortKey,
  descending: boolean,
  showHidden: boolean,
): FileEntry[] {
  const shown = showHidden ? entries : entries.filter((entry) => !entry.name.startsWith('.'));
  const direction = descending ? -1 : 1;
  const compare = (a: FileEntry, b: FileEntry) => {
    if (sort === 'size') return a.size - b.size;
    if (sort === 'modified') return (a.modified ?? 0) - (b.modified ?? 0);
    return byName.compare(a.name, b.name);
  };
  return [...shown].sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    return direction * compare(a, b) || byName.compare(a.name, b.name);
  });
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 || value >= 100 ? Math.round(value) : value.toFixed(1)} ${UNITS[unit]}`;
}

/** The path of `name` inside `folder`. */
export const join = (folder: string, name: string) =>
  folder.endsWith('/') ? `${folder}${name}` : `${folder}/${name}`;
