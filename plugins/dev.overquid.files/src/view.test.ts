import type { FileEntry } from '@overquid/sdk';
import { describe, expect, it } from 'vitest';
import { arrange, formatSize, join } from './view';

const file = (name: string, size = 0, modified = 0, dir = false): FileEntry => ({
  name,
  size,
  modified,
  dir,
  link: false,
});

describe('arrange', () => {
  const entries = [file('b.txt', 5, 1), file('a.txt', 9, 2), file('docs', 0, 3, true), file('.x')];
  const names = (sorted: FileEntry[]) => sorted.map((entry) => entry.name);

  it('lists folders first and leaves hidden files out', () => {
    expect(names(arrange(entries, 'name', false, false))).toEqual(['docs', 'a.txt', 'b.txt']);
  });

  it('shows hidden files when asked', () => {
    expect(names(arrange(entries, 'name', false, true))).toContain('.x');
  });

  it('sorts by size and date, both ways', () => {
    expect(names(arrange(entries, 'size', false, false))).toEqual(['docs', 'b.txt', 'a.txt']);
    expect(names(arrange(entries, 'size', true, false))).toEqual(['docs', 'a.txt', 'b.txt']);
    expect(names(arrange(entries, 'modified', false, false))).toEqual(['docs', 'b.txt', 'a.txt']);
  });

  it('orders numbers naturally', () => {
    const list = [file('img10'), file('img2')];
    expect(names(arrange(list, 'name', false, false))).toEqual(['img2', 'img10']);
  });
});

describe('helpers', () => {
  it('formats sizes', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(5 * 1024 ** 3)).toBe('5.0 GB');
    expect(formatSize(150 * 1024 ** 2)).toBe('150 MB');
  });

  it('joins paths', () => {
    expect(join('/home/a', 'b')).toBe('/home/a/b');
    expect(join('/', 'b')).toBe('/b');
  });
});
