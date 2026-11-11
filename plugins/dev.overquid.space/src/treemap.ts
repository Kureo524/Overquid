/** A squarified treemap: rectangles as close to square as the sizes allow. */

export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Placed<T> extends Area {
  item: T;
}

interface Weighted<T> {
  item: T;
  weight: number;
}

/** How elongated the worst rectangle of a row of `total` area is, on a side of `side`. */
function worstRatio<T>(row: Weighted<T>[], total: number, side: number): number {
  const sum = row.reduce((acc, entry) => acc + entry.weight, 0);
  let worst = 0;
  for (const { weight } of row) {
    const ratio = Math.max(
      (side * side * weight) / (sum * sum),
      (sum * sum) / (side * side * weight),
    );
    worst = Math.max(worst, ratio);
  }
  return total > 0 ? worst : Number.POSITIVE_INFINITY;
}

/** Lays `items` out in `area`, in proportion to `sizeOf`. Empty items are left out. */
export function treemap<T>(items: T[], sizeOf: (item: T) => number, area: Area): Placed<T>[] {
  const positive = items
    .map((item) => ({ item, size: sizeOf(item) }))
    .filter(({ size }) => size > 0)
    .sort((a, b) => b.size - a.size);
  const total = positive.reduce((acc, { size }) => acc + size, 0);
  if (total === 0 || area.width <= 0 || area.height <= 0) return [];
  const scale = (area.width * area.height) / total;
  const queue: Weighted<T>[] = positive.map(({ item, size }) => ({ item, weight: size * scale }));

  const placed: Placed<T>[] = [];
  let free = { ...area };
  let row: Weighted<T>[] = [];

  const flush = () => {
    const sum = row.reduce((acc, entry) => acc + entry.weight, 0);
    const across = free.width >= free.height;
    const thickness = sum / (across ? free.height : free.width);
    let offset = 0;
    for (const { item, weight } of row) {
      const length = weight / thickness;
      placed.push(
        across
          ? { item, x: free.x, y: free.y + offset, width: thickness, height: length }
          : { item, x: free.x + offset, y: free.y, width: length, height: thickness },
      );
      offset += length;
    }
    free = across
      ? { ...free, x: free.x + thickness, width: free.width - thickness }
      : { ...free, y: free.y + thickness, height: free.height - thickness };
    row = [];
  };

  for (const entry of queue) {
    const side = Math.min(free.width, free.height);
    const candidate = [...row, entry];
    if (row.length > 0 && worstRatio(candidate, 1, side) > worstRatio(row, 1, side)) flush();
    row.push(entry);
  }
  if (row.length > 0) flush();
  return placed;
}
