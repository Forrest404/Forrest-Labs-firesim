/**
 * Where responding units come from. Offline and deterministic: bases are placed a realistic
 * distance outside the grid (no Overpass / OSRM lookups, which were rate-limited and slow in
 * PR #4). Ground units enter where roads or rivers leave the grid: the border side with the most
 * non-burnable cells.
 */

import type { CellRef, GridSpec } from '../contract';
import { FuelClass } from '../contract';
import { METERS_PER_DEG_LAT, cellCenterLonLat, metersPerDegLon } from '../data/geo';
import type { Roster, UnitType } from './units';
import { UNITS, UNIT_TYPES } from './units';

export interface Station {
  id: string;
  name: string;
  type: UnitType;
  /** Base position (outside the grid). */
  lon: number;
  lat: number;
  /** Cell on the grid border where the unit arrives (ground) or crosses in (air). */
  entry: CellRef;
  entryLonLat: { lon: number; lat: number };
  baseToEntryKm: number;
  /** Base to entry, for drawing the approach. */
  routeWaypointsLonLat: [number, number][];
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance between two lon/lat points in kilometres. */
export function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** A gently winding polyline between two lon/lat points (roads are not straight). */
export function buildCurvedRoadWaypoints(lon1: number, lat1: number, lon2: number, lat2: number, segments = 10): [number, number][] {
  const pts: [number, number][] = [];
  const dLon = lon2 - lon1;
  const dLat = lat2 - lat1;
  const pLon = -dLat * 0.14;
  const pLat = dLon * 0.14;
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const wave = Math.sin(u * Math.PI * 2) * (1 - Math.abs(2 * u - 1)) * 0.65;
    pts.push([lon1 + dLon * u + pLon * wave, lat1 + dLat * u + pLat * wave]);
  }
  return pts;
}

type Side = 'N' | 'E' | 'S' | 'W';
const SIDES: Side[] = ['N', 'E', 'S', 'W'];

/** Border side where the most non-burnable cells (roads, rivers) touch the edge, and the entry cell there. */
export function roadEntry(grid: GridSpec, fuel: Uint8Array): { side: Side; cell: CellRef } {
  const { width: W, height: H } = grid;
  const band = 3;
  let best: { side: Side; count: number; cells: CellRef[] } | null = null;
  for (const side of SIDES) {
    const cells: CellRef[] = [];
    let count = 0;
    for (let i = 0; i < (side === 'N' || side === 'S' ? W : H); i++) {
      for (let b = 0; b < band; b++) {
        const row = side === 'N' ? b : side === 'S' ? H - 1 - b : i;
        const col = side === 'W' ? b : side === 'E' ? W - 1 - b : i;
        if (fuel[row * W + col] === FuelClass.NONE) {
          count++;
          if (b === 0) cells.push({ row, col });
        }
      }
    }
    if (!best || count > best.count) best = { side, count, cells };
  }
  const side = best?.side ?? 'S';
  const cells = best?.cells ?? [];
  const mid = side === 'N' || side === 'S' ? { row: side === 'N' ? 0 : H - 1, col: W >> 1 } : { row: H >> 1, col: side === 'W' ? 0 : W - 1 };
  if (cells.length === 0) return { side, cell: mid };
  // The border NONE cell nearest the middle of the run of NONE cells: where the main road leaves.
  const cr = cells.reduce((a, c) => a + c.row, 0) / cells.length;
  const cc = cells.reduce((a, c) => a + c.col, 0) / cells.length;
  let cell = cells[0];
  let d = Infinity;
  for (const c of cells) {
    const dd = (c.row - cr) ** 2 + (c.col - cc) ** 2;
    if (dd < d) {
      d = dd;
      cell = c;
    }
  }
  return { side, cell };
}

function outward(side: Side): { dRow: number; dCol: number } {
  return side === 'N' ? { dRow: -1, dCol: 0 } : side === 'S' ? { dRow: 1, dCol: 0 } : side === 'W' ? { dRow: 0, dCol: -1 } : { dRow: 0, dCol: 1 };
}

function offsetLonLat(grid: GridSpec, cell: CellRef, side: Side, km: number): { lon: number; lat: number } {
  const c = cellCenterLonLat(grid, cell.row, cell.col);
  const o = outward(side);
  const m = km * 1000;
  return { lon: c.lon + (o.dCol * m) / metersPerDegLon(c.lat), lat: c.lat - (o.dRow * m) / METERS_PER_DEG_LAT };
}

function nextSide(side: Side, steps: number): Side {
  return SIDES[(SIDES.indexOf(side) + steps) % 4];
}

function sideMid(grid: GridSpec, side: Side): CellRef {
  const { width: W, height: H } = grid;
  return side === 'N' ? { row: 0, col: W >> 1 } : side === 'S' ? { row: H - 1, col: W >> 1 } : side === 'W' ? { row: H >> 1, col: 0 } : { row: H >> 1, col: W - 1 };
}

/** Bases: ground 6 km out from the road entry, helibase 20 km off the adjacent side, airbase 60 km off the far side. */
export function defaultStations(grid: GridSpec, fuel: Uint8Array, roster: Roster): Station[] {
  const road = roadEntry(grid, fuel);
  const heliSide = nextSide(road.side, 1);
  const airSide = nextSide(road.side, 2);
  const out: Station[] = [];
  for (const type of UNIT_TYPES) {
    const n = roster[type] ?? 0;
    for (let i = 0; i < n; i++) {
      const spec = UNITS[type];
      const side = type === 'helicopter' ? heliSide : type === 'airtanker' ? airSide : road.side;
      const entry = type === 'helicopter' || type === 'airtanker' ? sideMid(grid, side) : road.cell;
      const km = type === 'helicopter' ? 20 : type === 'airtanker' ? 60 : 6;
      const base = offsetLonLat(grid, entry, side, km);
      const entryLonLat = cellCenterLonLat(grid, entry.row, entry.col);
      out.push({
        id: `${type}-${i + 1}`,
        name: n > 1 ? `${spec.label} ${i + 1}` : spec.label,
        type,
        lon: base.lon,
        lat: base.lat,
        entry,
        entryLonLat,
        baseToEntryKm: haversineKm(base.lon, base.lat, entryLonLat.lon, entryLonLat.lat),
        routeWaypointsLonLat: spec.airborne
          ? [[base.lon, base.lat], [entryLonLat.lon, entryLonLat.lat]]
          : buildCurvedRoadWaypoints(base.lon, base.lat, entryLonLat.lon, entryLonLat.lat),
      });
    }
  }
  return out;
}
