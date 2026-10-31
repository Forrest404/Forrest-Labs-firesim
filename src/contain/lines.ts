/**
 * Candidate control lines and how a unit actually builds one over time. Pure, worker-safe.
 *
 * A line is one cell wide and only ever touches burnable cells: roads, water and buildings are
 * free tie-ins, never "cleared". A ground unit works the line cell by cell at its production
 * rate, so segments complete later and later; if the fire reaches a cell before the crew does,
 * the crew pulls back and the line ends there. Aircraft lay short drops along the same path,
 * one per reload cycle.
 */

import { FuelClass, NEVER_ARRIVES, cellAreaHa, windTowardDeg } from '../contract';
import type { CellRef, GridSpec, Intervention } from '../contract';
import { lineCells } from '../data/raster';
import type { Pt } from '../data/raster';
import { clearedHaOf, nearHome } from './metrics';
import { FUEL_RATE_FACTOR, isForest } from './units';
import type { UnitSpec } from './units';

export interface LineBuild {
  segments: Intervention[];
  /** Treated cells in work order. */
  cells: number[];
  startT: number;
  endT: number;
  lengthM: number;
  clearedHa: number;
  waterL: number;
}

export interface BuildOptions {
  /** Level override: dozers may cut through forest. */
  forestAllowed?: boolean;
  /** Use water-type params (wet line) even for a firebreak unit: near homes nothing is cut. */
  wet?: boolean;
  label?: string;
}

const CELLS_PER_SEGMENT = 3;

function intervention(unit: UnitSpec, cells: number[], t: number, id: string, wet: boolean, label: string): Intervention {
  const water = wet || unit.tactic === 'wetline' || unit.airborne;
  return water
    ? { id, tSeconds: Math.max(0, t), type: 'water', cells: [...cells], params: { moistureBoost: unit.boost || 0.35, halfLifeS: unit.halfLifeS || 5400, radiusCells: 0 }, label }
    : { id, tSeconds: Math.max(0, t), type: 'firebreak', cells: [...cells], params: { widthCells: 1 }, label };
}

/** A ground unit builds `path` from its first point, starting at `startT`. */
export function buildLineSegments(
  grid: GridSpec,
  fuel: Uint8Array,
  homes: Uint16Array | null,
  path: Pt[],
  unit: UnitSpec,
  startT: number,
  budgetM: number,
  arrival: Float32Array,
  idPrefix: string,
  opts: BuildOptions = {},
): LineBuild {
  const cellHa = cellAreaHa(grid);
  const all = lineCells(grid.width, grid.height, path, 1);
  const forestOk = opts.forestAllowed ?? unit.forestAllowed;
  const wet = !!opts.wet;
  const label = opts.label ?? unit.label;
  const segments: Intervention[] = [];
  const cells: number[] = [];
  let seg: number[] = [];
  let t = startT;
  let lengthM = 0;
  let k = 0;
  const flush = (): void => {
    if (seg.length === 0) return;
    segments.push(intervention(unit, seg, t, `${idPrefix}-${k++}`, wet, label));
    seg = [];
  };
  for (const c of all) {
    const f = fuel[c] as FuelClass;
    if (f === FuelClass.NONE) continue;
    if (nearHome(homes, grid, c, unit.homesClearanceCells) && !wet) break;
    if (homes && homes[c] > 0) break;
    if (!forestOk && isForest(f)) break;
    if (lengthM + grid.cellSizeM > budgetM) break;
    const rate = unit.lineRateMpm * FUEL_RATE_FACTOR[f];
    const dt = (grid.cellSizeM / rate) * 60;
    if (arrival[c] <= t + dt) break;
    t += dt;
    lengthM += grid.cellSizeM;
    seg.push(c);
    cells.push(c);
    if (seg.length >= CELLS_PER_SEGMENT) flush();
  }
  flush();
  const firebreak = segments.length > 0 && segments[0].type === 'firebreak';
  return {
    segments,
    cells,
    startT,
    endT: t,
    lengthM,
    clearedHa: firebreak ? clearedHaOf(cells, fuel, cellHa) : 0,
    waterL: !firebreak && cells.length > 0 && unit.waterL ? unit.waterL : 0,
  };
}

/** An aircraft lays up to `maxDrops` drops of `unit.dropCells` cells along `path`, one per reload. */
export function buildDropSeries(
  grid: GridSpec,
  fuel: Uint8Array,
  homes: Uint16Array | null,
  path: Pt[],
  unit: UnitSpec,
  firstT: number,
  maxDrops: number,
  durationS: number,
  arrival: Float32Array,
  idPrefix: string,
  label = unit.label,
): LineBuild {
  const all = lineCells(grid.width, grid.height, path, 1).filter((c) => fuel[c] !== FuelClass.NONE && !(homes && homes[c] > 0));
  const segments: Intervention[] = [];
  const cells: number[] = [];
  let drops = 0;
  let endT = firstT;
  for (let i = 0; i < all.length && drops < maxDrops; i += unit.dropCells) {
    const dropT = firstT + drops * unit.turnaroundS;
    if (dropT > durationS) break;
    const chunk = all.slice(i, i + unit.dropCells).filter((c) => arrival[c] > dropT);
    if (chunk.length === 0) continue;
    segments.push(intervention(unit, chunk, dropT, `${idPrefix}-${drops}`, true, label));
    cells.push(...chunk);
    drops++;
    endT = dropT + 60;
  }
  return { segments, cells, startT: firstT, endT, lengthM: cells.length * grid.cellSizeM, clearedHa: 0, waterL: drops * unit.waterL };
}

export interface Candidate {
  sector: string;
  /** Cell-space polyline, first point nearest the unit. */
  path: Pt[];
  anchor: CellRef;
  /** Hectares (plus weighted homes) the fire would still burn beyond this sector after tLine. */
  threat: number;
}

const SECTORS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const WINDOWS = [900, 1800, 3600, Infinity];

function sectorOf(dRow: number, dCol: number): number {
  const bearing = ((Math.atan2(dCol, -dRow) * 180) / Math.PI + 360) % 360;
  return Math.round(bearing / 45) % 8;
}

/**
 * Control-line candidates around the fire as it stands in `arrival` at planning time: one per
 * compass sector, placed on the isochrone the fire reaches at `tLine` and running along it.
 */
export function candidateLines(
  grid: GridSpec,
  fuel: Uint8Array,
  homes: Uint16Array | null,
  ignition: CellRef,
  windFromDeg: number,
  arrival: Float32Array,
  tLine: number,
  lengthCells: number,
  count: number,
  opts: { exclude?: Set<string>; origin?: CellRef } = {},
): Candidate[] {
  const { width: W, height: H } = grid;
  const cellHa = cellAreaHa(grid);
  const toward = windTowardDeg(windFromDeg);
  const buckets: { i: number; a: number }[][] = SECTORS.map(() => []);
  const future = new Float64Array(8);
  for (let r = 1; r < H - 1; r++) {
    for (let c = 1; c < W - 1; c++) {
      const i = r * W + c;
      if (fuel[i] === FuelClass.NONE) {
        if (homes && homes[i] > 0 && arrival[i] !== NEVER_ARRIVES) {
          // homes are NONE cells; count the ones the fire reaches after tLine as threatened
          const s = sectorOf(r - ignition.row, c - ignition.col);
          if (arrival[i] > tLine) future[s] += 2 * homes[i];
        }
        continue;
      }
      const a = arrival[i];
      if (a === NEVER_ARRIVES) continue;
      if (r === ignition.row && c === ignition.col) continue;
      const s = sectorOf(r - ignition.row, c - ignition.col);
      if (a > tLine) future[s] += cellHa;
      buckets[s].push({ i, a });
    }
  }
  const out: Candidate[] = [];
  for (let s = 0; s < 8; s++) {
    if (opts.exclude?.has(SECTORS[s])) continue;
    const all = buckets[s];
    if (all.length < 5) continue;
    let pick: { i: number; a: number }[] = [];
    for (const w of WINDOWS) {
      pick = all.filter((x) => Math.abs(x.a - tLine) <= w && x.a >= tLine * 0.5);
      if (pick.length >= 5) break;
    }
    if (pick.length < 5) continue;
    pick.sort((p, q) => p.a - q.a);
    const anchorIdx = pick[pick.length >> 1].i;
    const ar = (anchorIdx / W) | 0;
    const ac = anchorIdx - ar * W;
    // Tangent: perpendicular to the arrival gradient (along the isochrone); radial fallback.
    const g = gradientAt(arrival, W, H, ar, ac);
    let tr: number;
    let tc: number;
    if (g && Math.hypot(g.gr, g.gc) > 1e-6) {
      const m = Math.hypot(g.gr, g.gc);
      tr = -g.gc / m;
      tc = g.gr / m;
    } else {
      const dr = ar - ignition.row;
      const dc = ac - ignition.col;
      const m = Math.max(1e-6, Math.hypot(dr, dc));
      tr = -dc / m;
      tc = dr / m;
    }
    const half = lengthCells / 2;
    const path: Pt[] = [];
    for (let d = -half; d <= half + 1e-9; d += 3) {
      const row = Math.round(ar + tr * d);
      const col = Math.round(ac + tc * d);
      if (row < 1 || row >= H - 1 || col < 1 || col >= W - 1) continue;
      path.push([col + 0.5, row + 0.5]);
    }
    if (path.length < 2) continue;
    if (opts.origin) {
      const d0 = (path[0][1] - opts.origin.row) ** 2 + (path[0][0] - opts.origin.col) ** 2;
      const d1 = (path[path.length - 1][1] - opts.origin.row) ** 2 + (path[path.length - 1][0] - opts.origin.col) ** 2;
      if (d1 < d0) path.reverse();
    }
    const angle = s * 45;
    const diff = ((angle - toward + 540) % 360) - 180;
    const downwind = 1 + 0.5 * Math.cos((diff * Math.PI) / 180);
    out.push({ sector: SECTORS[s], path, anchor: { row: ar, col: ac }, threat: future[s] * downwind });
  }
  out.sort((p, q) => q.threat - p.threat);
  return out.slice(0, count);
}

function gradientAt(arrival: Float32Array, W: number, H: number, r: number, c: number): { gr: number; gc: number } | null {
  const at = (rr: number, cc: number): number => (rr < 0 || cc < 0 || rr >= H || cc >= W ? NaN : arrival[rr * W + cc]);
  const diff = (a: number, b: number, span: number): number | null => (Number.isFinite(a) && Number.isFinite(b) ? (a - b) / span : null);
  const gc = diff(at(r, c + 2), at(r, c - 2), 4) ?? diff(at(r, c + 1), at(r, c - 1), 2) ?? diff(at(r, c + 1), at(r, c), 1) ?? diff(at(r, c), at(r, c - 1), 1);
  const gr = diff(at(r + 2, c), at(r - 2, c), 4) ?? diff(at(r + 1, c), at(r - 1, c), 2) ?? diff(at(r + 1, c), at(r, c), 1) ?? diff(at(r, c), at(r - 1, c), 1);
  if (gc === null || gr === null) return null;
  return { gr, gc };
}

export const SECTOR_NAMES = SECTORS;
