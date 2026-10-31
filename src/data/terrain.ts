/**
 * Elevation: Terrarium RGB tile decoding, sampling onto the grid, nodata filling, slope/aspect.
 * Pure; the caller supplies decoded tiles (pngjs in Node, canvas ImageData in the browser).
 *
 * Data source for real areas: AWS Terrain Tiles (Terrarium encoding), open data. Never Google.
 */

import { ELEVATION_NODATA } from '../contract';
import type { GridSpec } from '../contract';
import { cellCenterLonLat } from './geo';

export const TERRARIUM_URL_TEMPLATE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const TILE_SIZE = 256;

/** height = (R * 256 + G + B / 256) - 32768 */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** Decodes an RGBA pixel buffer (size x size) into metres. */
export function decodeTerrariumTile(rgba: Uint8Array | Uint8ClampedArray, size = TILE_SIZE): Float32Array {
  const out = new Float32Array(size * size);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = decodeTerrarium(rgba[p], rgba[p + 1], rgba[p + 2]);
  return out;
}

/** Global Web Mercator pixel coordinates at zoom z (for tile lookup and in-tile sampling). */
export function lonLatToGlobalPixel(lon: number, lat: number, z: number): { px: number; py: number } {
  const scale = TILE_SIZE * Math.pow(2, z);
  const latR = (lat * Math.PI) / 180;
  const px = ((lon + 180) / 360) * scale;
  const py = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * scale;
  return { px, py };
}

export function tileUrl(z: number, x: number, y: number, template = TERRARIUM_URL_TEMPLATE): string {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

/** Tile x/y ranges needed to cover the grid at zoom z. */
export function tilesForGrid(grid: GridSpec, z: number): { x: number; y: number }[] {
  const b = grid.bounds;
  const nw = lonLatToGlobalPixel(b.west, b.north, z);
  const se = lonLatToGlobalPixel(b.east, b.south, z);
  const tiles: { x: number; y: number }[] = [];
  for (let y = Math.floor(nw.py / TILE_SIZE); y <= Math.floor(se.py / TILE_SIZE); y++) {
    for (let x = Math.floor(nw.px / TILE_SIZE); x <= Math.floor(se.px / TILE_SIZE); x++) tiles.push({ x, y });
  }
  return tiles;
}

export type TileLookup = (x: number, y: number) => Float32Array | undefined;

/**
 * Bilinear sample of elevation at every cell centre. Cells whose tile is missing get
 * ELEVATION_NODATA; call fillNodata() afterwards.
 */
export function sampleElevationGrid(grid: GridSpec, z: number, getTile: TileLookup): Float32Array {
  const out = new Float32Array(grid.width * grid.height).fill(ELEVATION_NODATA);
  for (let r = 0; r < grid.height; r++) {
    for (let c = 0; c < grid.width; c++) {
      const { lon, lat } = cellCenterLonLat(grid, r, c);
      const { px, py } = lonLatToGlobalPixel(lon, lat, z);
      const tx = Math.floor(px / TILE_SIZE);
      const ty = Math.floor(py / TILE_SIZE);
      const tile = getTile(tx, ty);
      if (!tile) continue;
      const fx = px - tx * TILE_SIZE - 0.5;
      const fy = py - ty * TILE_SIZE - 0.5;
      const x0 = clamp(Math.floor(fx), 0, TILE_SIZE - 1);
      const y0 = clamp(Math.floor(fy), 0, TILE_SIZE - 1);
      const x1 = Math.min(x0 + 1, TILE_SIZE - 1);
      const y1 = Math.min(y0 + 1, TILE_SIZE - 1);
      const ax = clamp(fx - x0, 0, 1);
      const ay = clamp(fy - y0, 0, 1);
      const top = tile[y0 * TILE_SIZE + x0] * (1 - ax) + tile[y0 * TILE_SIZE + x1] * ax;
      const bottom = tile[y1 * TILE_SIZE + x0] * (1 - ax) + tile[y1 * TILE_SIZE + x1] * ax;
      out[r * grid.width + c] = top * (1 - ay) + bottom * ay;
    }
  }
  return out;
}

/**
 * Replaces nodata (and non-finite) cells with the value of the nearest valid cell (multi-source
 * BFS). If nothing is valid, fills with 0. Returns the number of cells filled.
 */
export function fillNodata(elev: Float32Array, width: number, height: number, nodata = ELEVATION_NODATA): number {
  const n = width * height;
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const valid = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(elev[i]) && elev[i] !== nodata) {
      valid[i] = 1;
      queue[tail++] = i;
    }
  }
  const missing = n - tail;
  if (missing === 0) return 0;
  if (tail === 0) {
    elev.fill(0);
    return n;
  }
  while (head < tail) {
    const i = queue[head++];
    const r = (i / width) | 0;
    const c = i - r * width;
    for (let k = 0; k < 4; k++) {
      const r2 = r + (k === 0 ? -1 : k === 1 ? 1 : 0);
      const c2 = c + (k === 2 ? -1 : k === 3 ? 1 : 0);
      if (r2 < 0 || c2 < 0 || r2 >= height || c2 >= width) continue;
      const j = r2 * width + c2;
      if (valid[j]) continue;
      valid[j] = 1;
      elev[j] = elev[i];
      queue[tail++] = j;
    }
  }
  return missing;
}

/**
 * Slope (degrees) and aspect (degrees clockwise from north, the direction the slope FACES, i.e.
 * downhill) by central differences. Edges use one-sided differences.
 */
export function computeSlopeAspect(
  elev: Float32Array,
  width: number,
  height: number,
  cellSizeM: number,
): { slopeDeg: Float32Array; aspectDeg: Float32Array } {
  const slopeDeg = new Float32Array(width * height);
  const aspectDeg = new Float32Array(width * height);
  const at = (r: number, c: number): number => elev[clamp(r, 0, height - 1) * width + clamp(c, 0, width - 1)];
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const dzdx = (at(r, c + 1) - at(r, c - 1)) / (2 * cellSizeM); // east positive
      const dzdy = (at(r - 1, c) - at(r + 1, c)) / (2 * cellSizeM); // north positive
      const i = r * width + c;
      slopeDeg[i] = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
      const a = (Math.atan2(-dzdx, -dzdy) * 180) / Math.PI;
      aspectDeg[i] = (a + 360) % 360;
    }
  }
  return { slopeDeg, aspectDeg };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
