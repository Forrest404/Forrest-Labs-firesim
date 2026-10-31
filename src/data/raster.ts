/**
 * Rasterisation onto the grid, in cell space: x = column (east), y = row (south), floats.
 * Cell (r, c) covers x in [c, c+1), y in [r, r+1). Pure; used by data builders and tools.
 */

/** A point in cell space. */
export type Pt = readonly [number, number];

/**
 * Even-odd scanline fill over any number of rings (outer rings and holes together).
 * Returns the number of cells written.
 */
export function rasterizePolygon(
  target: Uint8Array,
  width: number,
  height: number,
  rings: Pt[][],
  value: number,
): number {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const [, y] of ring) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!(minY <= maxY)) return 0;
  const r0 = Math.max(0, Math.floor(minY));
  const r1 = Math.min(height - 1, Math.ceil(maxY));
  const xs: number[] = [];
  let count = 0;
  for (let r = r0; r <= r1; r++) {
    const y = r + 0.5;
    xs.length = 0;
    for (const ring of rings) {
      const len = ring.length;
      if (len < 3) continue;
      for (let i = 0; i < len; i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[(i + 1) % len];
        if (y1 <= y !== y2 <= y) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const c1 = Math.min(width - 1, Math.floor(xs[k + 1] - 0.5));
      for (let c = c0; c <= c1; c++) {
        target[r * width + c] = value;
        count++;
      }
    }
  }
  return count;
}

/**
 * Cells covered by a polyline. Width 1 gives a 4-connected line (no diagonal gaps a fire could
 * slip through). Wider lines stamp a disc of the given width at each step. Unique, in path order.
 */
export function lineCells(width: number, height: number, points: Pt[], widthCells = 1): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  const add = (r: number, c: number): void => {
    if (r < 0 || c < 0 || r >= height || c >= width) return;
    const i = r * width + c;
    if (!seen.has(i)) {
      seen.add(i);
      out.push(i);
    }
  };
  const radius = Math.max(0, (widthCells - 1) / 2);
  const rad2 = (radius + 0.5) * (radius + 0.5);
  const reach = Math.ceil(radius);
  const stamp = (x: number, y: number): void => {
    const r = Math.floor(y);
    const c = Math.floor(x);
    if (widthCells <= 1) {
      add(r, c);
      return;
    }
    for (let dr = -reach; dr <= reach; dr++) {
      for (let dc = -reach; dc <= reach; dc++) if (dr * dr + dc * dc <= rad2) add(r + dr, c + dc);
    }
  };

  if (points.length === 1) stamp(points[0][0], points[0][1]);
  for (let s = 0; s + 1 < points.length; s++) {
    const [px, py] = points[s];
    const [qx, qy] = points[s + 1];
    const dx = qx - px;
    const dy = qy - py;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2));
    let prevR = Math.floor(py);
    let prevC = Math.floor(px);
    for (let k = 0; k <= steps; k++) {
      const x = px + (dx * k) / steps;
      const y = py + (dy * k) / steps;
      const r = Math.floor(y);
      const c = Math.floor(x);
      if (r !== prevR && c !== prevC) add(prevR, c); // orthogonal bridge keeps it 4-connected
      stamp(x, y);
      prevR = r;
      prevC = c;
    }
  }
  return out;
}

export function rasterizeLine(
  target: Uint8Array,
  width: number,
  height: number,
  points: Pt[],
  value: number,
  widthCells = 1,
): number {
  const cells = lineCells(width, height, points, widthCells);
  for (const i of cells) target[i] = value;
  return cells.length;
}

/** Cells within `radiusCells` of a centre (cell-space floats). */
export function discCells(width: number, height: number, cx: number, cy: number, radiusCells: number): number[] {
  const out: number[] = [];
  const r0 = Math.max(0, Math.floor(cy - radiusCells));
  const r1 = Math.min(height - 1, Math.ceil(cy + radiusCells));
  const c0 = Math.max(0, Math.floor(cx - radiusCells));
  const c1 = Math.min(width - 1, Math.ceil(cx + radiusCells));
  const rad2 = radiusCells * radiusCells;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const ddx = c + 0.5 - cx;
      const ddy = r + 0.5 - cy;
      if (ddx * ddx + ddy * ddy <= rad2) out.push(r * width + c);
    }
  }
  return out;
}
