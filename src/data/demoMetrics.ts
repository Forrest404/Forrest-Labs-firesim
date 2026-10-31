/**
 * Measurements on a finished run, shared by the tuning script and the tests: how big, which way it
 * ran, how elongated, when it reached a zone. Pure; cell space (row 0 = north, col 0 = west).
 */

import type { CellRef, GridSpec } from '../contract';

export interface Zone {
  /** Cell indices (row * width + col). */
  cells: number[];
}

/** Cells within `radiusCells` of a centre cell, clipped to the grid. */
export function discZone(grid: GridSpec, centre: CellRef, radiusCells: number): Zone {
  const cells: number[] = [];
  const r2 = radiusCells * radiusCells;
  for (let r = Math.max(0, centre.row - radiusCells); r <= Math.min(grid.height - 1, centre.row + radiusCells); r++) {
    for (let c = Math.max(0, centre.col - radiusCells); c <= Math.min(grid.width - 1, centre.col + radiusCells); c++) {
      if ((r - centre.row) ** 2 + (c - centre.col) ** 2 <= r2) cells.push(r * grid.width + c);
    }
  }
  return { cells };
}

/** Earliest arrival (seconds) over a zone; Infinity if the fire never gets there. */
export function arrivalAtZone(arrival: Float32Array, zone: Zone): number {
  let t = Infinity;
  for (const i of zone.cells) if (arrival[i] < t) t = arrival[i];
  return t;
}

export interface Shape {
  burnedCells: number;
  hectares: number;
  /** Centroid of the burned area relative to the ignition, metres (x east, y north). */
  centroidEastM: number;
  centroidNorthM: number;
  /** Bearing from the ignition to the centroid, degrees clockwise from north (0-360). NaN if nothing burned beyond the ignition. */
  headBearingDeg: number;
  /** sqrt(major / minor variance): 1 is a disc, bigger is more elongated. */
  elongation: number;
  /** Bearing of the long axis, degrees clockwise from north, in [0, 180). */
  axisBearingDeg: number;
  /** Length / width of the burned area measured along its principal axes (extent, not variance): what the eye sees. */
  aspect: number;
  /** How far the burned area reaches from the ignition ahead of the head (along the head bearing) and behind it, metres. */
  aheadM: number;
  behindM: number;
}

/** Shape of everything that burned by `untilS` (default: all finite arrivals). */
export function burnedShape(grid: GridSpec, arrival: Float32Array, ignition: CellRef, untilS = Infinity): Shape {
  const { width, height, cellSizeM } = grid;
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const t = arrival[r * width + c];
      if (!(t <= untilS) || t === Infinity) continue;
      const x = (c - ignition.col) * cellSizeM; // east
      const y = (ignition.row - r) * cellSizeM; // north
      n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
    }
  }
  if (n === 0) return { burnedCells: 0, hectares: 0, centroidEastM: 0, centroidNorthM: 0, headBearingDeg: NaN, elongation: 1, axisBearingDeg: 0, aspect: 1, aheadM: 0, behindM: 0 };
  const mx = sx / n, my = sy / n;
  const vxx = sxx / n - mx * mx, vyy = syy / n - my * my, vxy = sxy / n - mx * my;
  const tr = vxx + vyy, det = vxx * vyy - vxy * vxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(1e-9, tr / 2 - disc);
  // major axis direction (east, north) -> bearing clockwise from north
  const theta = 0.5 * Math.atan2(2 * vxy, vxx - vyy); // angle from east, counter-clockwise
  const axis = ((((90 - (theta * 180) / Math.PI) % 180) + 180) % 180);
  const head = Math.hypot(mx, my) < 1e-6 ? NaN : ((Math.atan2(mx, my) * 180) / Math.PI + 360) % 360;
  // extent along the major and the minor axis (cells are measured by their centres, plus one cell)
  const ux = Math.cos(theta), uy = Math.sin(theta);
  let lo1 = Infinity, hi1 = -Infinity, lo2 = Infinity, hi2 = -Infinity;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const t = arrival[r * width + c];
      if (!(t <= untilS) || t === Infinity) continue;
      const x = (c - ignition.col) * cellSizeM, y = (ignition.row - r) * cellSizeM;
      const p1 = x * ux + y * uy, p2 = -x * uy + y * ux;
      if (p1 < lo1) lo1 = p1; if (p1 > hi1) hi1 = p1; if (p2 < lo2) lo2 = p2; if (p2 > hi2) hi2 = p2;
    }
  }
  const aspect = (hi1 - lo1 + cellSizeM) / (hi2 - lo2 + cellSizeM);
  // reach ahead of / behind the ignition along the head direction
  const hx = Number.isNaN(head) ? ux : Math.sin((head * Math.PI) / 180);
  const hy = Number.isNaN(head) ? uy : Math.cos((head * Math.PI) / 180);
  let ahead = 0, behind = 0;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const t = arrival[r * width + c];
      if (!(t <= untilS) || t === Infinity) continue;
      const p = (c - ignition.col) * cellSizeM * hx + (ignition.row - r) * cellSizeM * hy;
      if (p > ahead) ahead = p;
      if (-p > behind) behind = -p;
    }
  }
  return {
    burnedCells: n,
    hectares: (n * cellSizeM * cellSizeM) / 10_000,
    centroidEastM: mx,
    centroidNorthM: my,
    headBearingDeg: head,
    elongation: Math.sqrt(l1 / l2),
    axisBearingDeg: axis,
    aspect,
    aheadM: ahead + cellSizeM / 2,
    behindM: behind + cellSizeM / 2,
  };
}

/** Smallest angle between two bearings (degrees, 0-180). */
export function bearingGap(a: number, b: number): number {
  const d = Math.abs(((a - b + 540) % 360) - 180);
  return d;
}

/** Earliest arrival over the cells of a polyline-derived line (e.g. a firebreak), without its own effect. */
export function arrivalAtCells(arrival: Float32Array, cells: number[]): number {
  return arrivalAtZone(arrival, { cells });
}
