/**
 * Marching squares on a cell-centred scalar field, producing closed rings and polygons with holes.
 * Pure geometry in CELL space (x = column, y = row, cell (r, c) is centred at (c + 0.5, r + 0.5));
 * conversion to lon/lat lives in src/export/geojson.ts.
 *
 * Used for fire perimeters (the contour of the arrival-time field at time t, "inside" = arrival <= t)
 * and for ensemble probability lines ("inside" = probability >= level).
 *
 * The field is padded by one "outside" sample all around so every contour closes, even where the fire
 * touches the edge of the grid (the ring then runs half a cell outside the outermost cell centres, i.e.
 * along the grid boundary). Where a crossing lies between a finite sample and an infinite or padded one
 * (an unburned cell has arrival Infinity) it is placed at the midpoint.
 */

export type Pt = readonly [number, number];
export type ContourMode = 'below' | 'above';

export interface ContourPolygon {
  /** Exterior ring, closed implicitly (the last point is not repeated). */
  outer: Pt[];
  holes: Pt[][];
}

/** Signed area of a ring (shoelace, positive when counter-clockwise in a y-up frame). */
export function ringArea(ring: readonly Pt[]): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function ringLength(ring: readonly Pt[]): number {
  let l = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    l += Math.hypot(x2 - x1, y2 - y1);
  }
  return l;
}

export function pointInRing(p: Pt, ring: readonly Pt[]): boolean {
  let inside = false;
  const [px, py] = p;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Corner order TL, TR, BR, BL; edges T, R, B, L. Pairs of edges joined by a segment, per case. */
const T = 0, R = 1, B = 2, L = 3;
const CASES: readonly (readonly (readonly [number, number])[])[] = [
  [], [[L, T]], [[T, R]], [[L, R]], [[R, B]], [], [[T, B]], [[L, B]],
  [[L, B]], [[T, B]], [], [[R, B]], [[L, R]], [[T, R]], [[L, T]], [],
];

/**
 * Closed rings of the contour. `values` is row-major (width x height). A sample is "inside" when
 * `v <= level` (mode 'below') or `v >= level` (mode 'above'); NaN is always outside.
 */
export function contourRings(values: ArrayLike<number>, width: number, height: number, level: number, mode: ContourMode = 'below'): Pt[][] {
  const W = width + 2;
  const H = height + 2;
  const outsideSentinel = mode === 'below' ? Infinity : -Infinity;
  const sample = (i: number, j: number): number => {
    const r = i - 1;
    const c = j - 1;
    return r < 0 || c < 0 || r >= height || c >= width ? outsideSentinel : values[r * width + c];
  };
  const inside = (v: number): boolean => (mode === 'below' ? v <= level : v >= level);

  // Crossing point on the edge between samples a (index ia) and b: id and position.
  const pointOf = (id: number): Pt => {
    const horizontal = (id & 1) === 0;
    const base = id >> 1;
    const i = Math.floor(base / W);
    const j = base % W;
    const a = sample(i, j);
    const b = horizontal ? sample(i, j + 1) : sample(i + 1, j);
    let t = 0.5;
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b) t = Math.min(1, Math.max(0, (level - a) / (b - a)));
    return horizontal ? [j - 0.5 + t, i - 0.5] : [j - 0.5, i - 0.5 + t];
  };
  const edgeId = (i: number, j: number, e: number): number => {
    // Horizontal edge ids are even, vertical odd; each is keyed by its first sample.
    switch (e) {
      case T: return 2 * (i * W + j);
      case B: return 2 * ((i + 1) * W + j);
      case L: return 2 * (i * W + j) + 1;
      default: return 2 * (i * W + j + 1) + 1; // R
    }
  };

  const adjacency = new Map<number, number[]>();
  const link = (a: number, b: number): void => {
    (adjacency.get(a) ?? adjacency.set(a, []).get(a)!).push(b);
    (adjacency.get(b) ?? adjacency.set(b, []).get(b)!).push(a);
  };

  for (let i = 0; i < H - 1; i++) {
    for (let j = 0; j < W - 1; j++) {
      const tl = sample(i, j), tr = sample(i, j + 1), br = sample(i + 1, j + 1), bl = sample(i + 1, j);
      const b0 = inside(tl), b1 = inside(tr), b2 = inside(br), b3 = inside(bl);
      const idx = (b0 ? 1 : 0) | (b1 ? 2 : 0) | (b2 ? 4 : 0) | (b3 ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      let segs = CASES[idx];
      if (idx === 5 || idx === 10) {
        // Saddle: the centre value decides whether the inside corners are joined. An infinite or
        // padded corner makes the centre outside, so the inside corners stay separate.
        const centre = (tl + tr + br + bl) / 4;
        const centreInside = Number.isFinite(centre) && inside(centre);
        if (idx === 5) segs = centreInside ? [[T, R], [L, B]] : [[L, T], [R, B]];
        else segs = centreInside ? [[L, T], [R, B]] : [[T, R], [L, B]];
      }
      for (const [e1, e2] of segs) link(edgeId(i, j, e1), edgeId(i, j, e2));
    }
  }

  // Walk the segments into closed rings.
  const rings: Pt[][] = [];
  const visited = new Set<number>();
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    const ring: Pt[] = [];
    let prev = -1;
    let cur = start;
    for (;;) {
      visited.add(cur);
      ring.push(pointOf(cur));
      const nbrs = adjacency.get(cur)!;
      const next = nbrs[0] !== prev && !visited.has(nbrs[0]) ? nbrs[0] : nbrs[1] !== prev && !visited.has(nbrs[1]) ? nbrs[1] : -1;
      if (next < 0) break;
      prev = cur;
      cur = next;
    }
    if (ring.length >= 3) rings.push(dedupe(ring));
  }
  return rings;
}

function dedupe(ring: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 1e-9 || Math.abs(last[1] - p[1]) > 1e-9) out.push(p);
  }
  if (out.length > 1) {
    const f = out[0], l = out[out.length - 1];
    if (Math.abs(f[0] - l[0]) < 1e-9 && Math.abs(f[1] - l[1]) < 1e-9) out.pop();
  }
  return out;
}

/** Groups rings into polygons with holes by nesting depth: even depth = exterior, odd = hole of its parent. */
export function ringsToPolygons(rings: Pt[][]): ContourPolygon[] {
  const areas = rings.map((r) => Math.abs(ringArea(r)));
  const parent = rings.map((r, i) => {
    let best = -1;
    for (let j = 0; j < rings.length; j++) {
      if (j === i || areas[j] <= areas[i]) continue;
      if (pointInRing(r[0], rings[j]) && (best < 0 || areas[j] < areas[best])) best = j;
    }
    return best;
  });
  const depth = (i: number): number => (parent[i] < 0 ? 0 : 1 + depth(parent[i]));
  const polys = new Map<number, ContourPolygon>();
  rings.forEach((r, i) => {
    if (depth(i) % 2 === 0) polys.set(i, { outer: r, holes: [] });
  });
  rings.forEach((r, i) => {
    if (depth(i) % 2 === 1) polys.get(parent[i])?.holes.push(r);
  });
  return [...polys.values()];
}

export function contourPolygons(values: ArrayLike<number>, width: number, height: number, level: number, mode: ContourMode = 'below'): ContourPolygon[] {
  return ringsToPolygons(contourRings(values, width, height, level, mode));
}

/** Area of a polygon in cell units (exterior minus holes). */
export function polygonArea(p: ContourPolygon): number {
  let a = Math.abs(ringArea(p.outer));
  for (const h of p.holes) a -= Math.abs(ringArea(h));
  return a;
}
