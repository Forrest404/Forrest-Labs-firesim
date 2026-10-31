import { describe, expect, it } from 'vitest';
import { fromArrayBuffer, writeArrayBuffer } from 'geotiff';
import { FuelClass } from '../src/contract';
import type { GridSpec } from '../src/contract';
import { makeGridSpec } from '../src/data/geo';
import {
  CORINE_CLASSES, WORLDCOVER_CLASSES, fuelForLandcover, landcoverClasses, landcoverToFuel, resampleCategorical, worldCoverTileName,
} from '../src/data/landcover';
import type { SourceRaster } from '../src/data/landcover';
import { buildFuelGrid } from '../src/data/osm';
import type { OsmElement } from '../src/data/osm';
import { mulberry32 } from '../src/sim/prng';
import { mosaic, parseAsciiGrid, readGeoTiffWindow } from '../scripts/lib/landcover-io';

const grid = (w: number, h: number, lon = 8.4, lat = 48.3): GridSpec => makeGridSpec({ centerLon: lon, centerLat: lat, width: w, height: h });

describe('class tables', () => {
  it('cover the official legends and map every class to a valid fuel class', () => {
    expect(Object.keys(WORLDCOVER_CLASSES).map(Number).sort((a, b) => a - b)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100]);
    expect(Object.keys(CORINE_CLASSES).length).toBe(44);
    for (const kind of ['worldcover', 'corine'] as const) {
      for (const [code, cls] of Object.entries(landcoverClasses(kind))) {
        expect(cls.name.length, `${kind} ${code}`).toBeGreaterThan(2);
        const f = fuelForLandcover(kind, Number(code));
        expect(Object.values(FuelClass)).toContain(f);
      }
    }
  });

  it('sensible fuels: forest burns, water and buildings do not, crops are farmland', () => {
    expect(fuelForLandcover('worldcover', 10)).toBe(FuelClass.FOREST_CONIFER);
    expect(fuelForLandcover('worldcover', 10, { treeFuel: FuelClass.FOREST_DECIDUOUS })).toBe(FuelClass.FOREST_DECIDUOUS);
    expect(fuelForLandcover('worldcover', 20)).toBe(FuelClass.SHRUB);
    expect(fuelForLandcover('worldcover', 30)).toBe(FuelClass.GRASS);
    expect(fuelForLandcover('worldcover', 40)).toBe(FuelClass.FARMLAND);
    for (const c of [50, 60, 70, 80]) expect(fuelForLandcover('worldcover', c)).toBe(FuelClass.NONE);
    expect(fuelForLandcover('corine', 311)).toBe(FuelClass.FOREST_DECIDUOUS);
    expect(fuelForLandcover('corine', 312)).toBe(FuelClass.FOREST_CONIFER);
    expect(fuelForLandcover('corine', 312, { treeFuel: FuelClass.FOREST_DECIDUOUS })).toBe(FuelClass.FOREST_CONIFER); // CORINE names the forest type
    for (const c of [111, 122, 512, 523]) expect(fuelForLandcover('corine', c)).toBe(FuelClass.NONE);
  });

  it('unknown codes and no-data fall back to non-burnable, or to the chosen fuel', () => {
    expect(fuelForLandcover('worldcover', 0)).toBe(FuelClass.NONE);
    expect(fuelForLandcover('worldcover', 7)).toBe(FuelClass.NONE);
    expect(fuelForLandcover('worldcover', 0, { unknownFuel: FuelClass.GRASS })).toBe(FuelClass.GRASS);
    const r = landcoverToFuel([10, 10, 0, 7, 80, 30], 'worldcover');
    expect(Array.from(r.fuel)).toEqual([4, 4, 0, 0, 0, 1]);
    expect(r.unknown.get(0)).toBe(1);
    expect(r.unknown.get(7)).toBe(1);
    expect(r.fuelCounts[FuelClass.FOREST_CONIFER]).toBe(2);
  });
});

describe('WorldCover tile names', () => {
  it('3-degree tiles named by their south-west corner, across hemispheres', () => {
    expect(worldCoverTileName(-122.1, 37.1).name).toBe('ESA_WorldCover_10m_2021_v200_N36W123_Map.tif');
    expect(worldCoverTileName(8.4, 48.3).name).toBe('ESA_WorldCover_10m_2021_v200_N48E006_Map.tif');
    expect(worldCoverTileName(-0.1, 51.5).name).toBe('ESA_WorldCover_10m_2021_v200_N51W003_Map.tif');
    expect(worldCoverTileName(0.1, -0.1).name).toBe('ESA_WorldCover_10m_2021_v200_S03E000_Map.tif');
    expect(worldCoverTileName(151.2, -33.9).name).toBe('ESA_WorldCover_10m_2021_v200_S36E150_Map.tif');
    expect(worldCoverTileName(-123, 36)).toMatchObject({ swLon: -123, swLat: 36 }); // exactly on a corner
    expect(worldCoverTileName(5.9999, 47.9999).name).toContain('N45E003');
  });
});

describe('resampling to the grid', () => {
  it('an aligned raster (3 x 3 pixels per cell) comes through exactly, north-up and west-east', () => {
    const g = grid(6, 4);
    const b = g.bounds;
    const cellLon = (b.east - b.west) / 6;
    const cellLat = (b.north - b.south) / 4;
    const data = new Uint8Array(18 * 12);
    for (let y = 0; y < 12; y++) for (let x = 0; x < 18; x++) data[y * 18 + x] = 10 + Math.floor(y / 3) * 10 + Math.floor(x / 3); // row/col encoded
    const src: SourceRaster = { data, width: 18, height: 12, west: b.west, north: b.north, pxLon: cellLon / 3, pxLat: cellLat / 3 };
    const { classes, uncovered } = resampleCategorical(src, g);
    expect(uncovered).toBe(0);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) expect(classes[r * 6 + c], `cell ${r},${c}`).toBe(10 + r * 10 + c);
  });

  it('every source pixel inside the grid is used exactly once, and none outside (conservation)', () => {
    const g = grid(7, 5);
    const b = g.bounds;
    const cellLon = (b.east - b.west) / 7;
    const cellLat = (b.north - b.south) / 5;
    // A raster 3 cells larger on every side, with an awkward pixel size that does not divide the cells.
    const px = cellLon / 2.7;
    const py = cellLat / 3.3;
    const width = Math.ceil((b.east - b.west + 6 * cellLon) / px);
    const height = Math.ceil((b.north - b.south + 6 * cellLat) / py);
    const reads = new Uint32Array(width * height);
    const proxy = new Proxy({ length: width * height } as ArrayLike<number>, { get: (_t, k) => { if (typeof k === 'string' && /^\d+$/.test(k)) { reads[Number(k)]++; return 1; } return undefined; } });
    const src: SourceRaster = { data: proxy, width, height, west: b.west - 3 * cellLon, north: b.north + 3 * cellLat, pxLon: px, pxLat: py };
    resampleCategorical(src, g);
    let inside = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const lon = src.west + (x + 0.5) * px;
        const lat = src.north - (y + 0.5) * py;
        const within = lon >= b.west && lon < b.east && lat > b.south && lat <= b.north;
        if (within) inside++;
        expect(reads[y * width + x], `pixel ${x},${y}`).toBeLessThanOrEqual(1);
        if (within) expect(reads[y * width + x], `pixel ${x},${y} inside`).toBe(1);
        else expect(reads[y * width + x], `pixel ${x},${y} outside`).toBe(0);
      }
    }
    expect(inside).toBeGreaterThan(7 * 5 * 6);
  });

  it('matches an independent brute-force reference on random rasters and grids (fuzz: 80 cases)', () => {
    for (let seed = 1; seed <= 80; seed++) {
      const rand = mulberry32(seed);
      const g = grid(4 + Math.floor(rand() * 9), 4 + Math.floor(rand() * 9), 8 + rand(), 48 + rand());
      const b = g.bounds;
      const cellLon = (b.east - b.west) / g.width;
      const cellLat = (b.north - b.south) / g.height;
      const px = cellLon / (0.6 + rand() * 4);
      const py = cellLat / (0.6 + rand() * 4);
      const west = b.west - rand() * 2 * cellLon;
      const north = b.north + rand() * 2 * cellLat;
      const width = Math.ceil((b.east - west) / px) + Math.floor(rand() * 3);
      const height = Math.ceil((north - b.south) / py) + Math.floor(rand() * 3);
      const palette = [0, 10, 20, 30, 40, 50];
      const data = new Uint8Array(width * height).map(() => palette[Math.floor(rand() * palette.length)]);
      const src: SourceRaster = { data, width, height, west, north, pxLon: px, pxLat: py };
      const out = resampleCategorical(src, g).classes;
      // Reference: bucket every pixel by the cell its centre falls in.
      const buckets: Map<number, number>[] = Array.from({ length: g.width * g.height }, () => new Map());
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const lon = west + (x + 0.5) * px;
          const lat = north - (y + 0.5) * py;
          const cx = Math.floor((lon - b.west) / cellLon);
          const cy = Math.floor((b.north - lat) / cellLat);
          if (cx < 0 || cy < 0 || cx >= g.width || cy >= g.height) continue;
          const v = data[y * width + x];
          if (v === 0) continue;
          const m = buckets[cy * g.width + cx];
          m.set(v, (m.get(v) ?? 0) + 1);
        }
      }
      let mismatches = 0;
      for (let i = 0; i < buckets.length; i++) {
        let best = 0, bestN = 0;
        for (const [v, n] of buckets[i]) if (n > bestN || (n === bestN && v < best)) { best = v; bestN = n; }
        if (out[i] !== best) mismatches++;
      }
      // Cell edges that coincide exactly with a pixel centre can differ by float rounding; allow a sliver.
      expect(mismatches, `seed ${seed}`).toBeLessThanOrEqual(Math.ceil(buckets.length * 0.01));
    }
  });

  it('majority wins, ties go to the lower code, no-data pixels are ignored, and uncovered cells are 0', () => {
    const g = grid(2, 1);
    const b = g.bounds;
    const cellLon = (b.east - b.west) / 2;
    const cellLat = b.north - b.south;
    // 4 x 2 pixels: left cell = {30,30,30,10,...}; right cell = tie between 40 and 20, plus no-data.
    const data = new Uint8Array([30, 30, 20, 40, 30, 10, 40, 20]);
    const src: SourceRaster = { data, width: 4, height: 2, west: b.west, north: b.north, pxLon: cellLon / 2, pxLat: cellLat / 2 };
    const { classes } = resampleCategorical(src, g);
    expect(classes[0]).toBe(30);
    expect(classes[1]).toBe(20); // 20 x 2 vs 40 x 2: tie, lower code
    const nd = new Uint8Array([0, 0, 0, 0, 0, 0, 7, 0]);
    expect(Array.from(resampleCategorical({ ...src, data: nd }, g).classes)).toEqual([0, 7]);
    // A raster covering only the western half.
    const half: SourceRaster = { data: new Uint8Array([30, 30]), width: 1, height: 2, west: b.west, north: b.north, pxLon: cellLon, pxLat: cellLat / 2 };
    const r = resampleCategorical(half, g);
    expect(Array.from(r.classes)).toEqual([30, 0]);
    expect(r.uncovered).toBe(1);
  });
});

describe('readers (Node)', () => {
  const metadata = (w: number, h: number, west: number, north: number, px: number) => ({
    height: h, width: w, ModelPixelScale: [px, px, 0], ModelTiepoint: [0, 0, 0, west, north, 0],
    GTModelTypeGeoKey: 2, GTRasterTypeGeoKey: 1, GeographicTypeGeoKey: 4326, GeogAngularUnitsGeoKey: 9102,
  });

  it('reads a window out of an in-memory GeoTIFF with the right georeferencing and values', async () => {
    const W = 40, H = 30, px = 0.001, west = 8.30, north = 48.40;
    const values = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) values[y * W + x] = 10 + ((x >> 3) + (y >> 3) * 5) * 10 % 100;
    const buf = writeArrayBuffer(values, metadata(W, H, west, north, px)) as ArrayBuffer;
    const tiff = await fromArrayBuffer(buf);
    const win = await readGeoTiffWindow(tiff, { west: west + 0.010, east: west + 0.024, north: north - 0.008, south: north - 0.018 });
    expect(win).not.toBeNull();
    expect(win!.pxLon).toBeCloseTo(px, 12);
    expect(win!.pxLat).toBeCloseTo(px, 12);
    // Georeferencing: pixel (0,0) of the window sits where the file says it does.
    const col0 = Math.round((win!.west - west) / px);
    const row0 = Math.round((north - win!.north) / px);
    for (let y = 0; y < win!.height; y++) for (let x = 0; x < win!.width; x++) expect(win!.data[y * win!.width + x]).toBe(values[(row0 + y) * W + col0 + x]);
    expect(win!.west).toBeLessThanOrEqual(west + 0.010);
    expect(win!.west + win!.width * px).toBeGreaterThanOrEqual(west + 0.024);
    // A window that does not overlap the raster at all.
    expect(await readGeoTiffWindow(tiff, { west: 100, east: 100.1, north: 10.1, south: 10 })).toBeNull();
  });

  it('refuses a raster that is not geographic WGS84, with an actionable message', async () => {
    const bad = { ...metadata(8, 8, 8.3, 48.4, 0.001), GTModelTypeGeoKey: 1, ProjectedCSTypeGeoKey: 3035, GeographicTypeGeoKey: undefined } as Record<string, unknown>;
    delete bad.GeographicTypeGeoKey;
    const buf = writeArrayBuffer(new Uint8Array(64), bad as never) as ArrayBuffer;
    await expect(readGeoTiffWindow(await fromArrayBuffer(buf), { west: 8.3, east: 8.31, north: 48.4, south: 48.39 })).rejects.toThrow(/gdalwarp/);
  });

  it('stitches neighbouring tiles on the same pixel lattice and leaves gaps as no-data', () => {
    const a: SourceRaster = { data: new Uint8Array([1, 2, 3, 4]), width: 2, height: 2, west: 0, north: 2, pxLon: 1, pxLat: 1 };
    const b: SourceRaster = { data: new Uint8Array([5, 6, 7, 8]), width: 2, height: 2, west: 2, north: 2, pxLon: 1, pxLat: 1 };
    const m = mosaic([a, b]);
    expect([m.width, m.height, m.west, m.north]).toEqual([4, 2, 0, 2]);
    expect(Array.from(m.data)).toEqual([1, 2, 5, 6, 3, 4, 7, 8]);
    const below: SourceRaster = { data: new Uint8Array([9]), width: 1, height: 1, west: 0, north: 0, pxLon: 1, pxLat: 1 };
    const g = mosaic([a, below]);
    expect([g.width, g.height]).toEqual([2, 3]);
    expect(Array.from(g.data)).toEqual([1, 2, 3, 4, 9, 0]);
  });

  it('parses ESRI ASCII grids: corner and centre headers, no-data, and bad input', () => {
    const corner = parseAsciiGrid('ncols 3\nnrows 2\nxllcorner 8.0\nyllcorner 48.0\ncellsize 0.5\nNODATA_value -9999\n10 20 30\n40 -9999 60\n');
    expect([corner.width, corner.height, corner.west, corner.north, corner.pxLon, corner.pxLat]).toEqual([3, 2, 8, 49, 0.5, 0.5]);
    expect(Array.from(corner.data)).toEqual([10, 20, 30, 40, 0, 60]);
    const centre = parseAsciiGrid('ncols 2\nnrows 1\nxllcenter 8.25\nyllcenter 48.25\ncellsize 0.5\n1 2\n');
    expect(centre.west).toBeCloseTo(8, 12);
    expect(centre.north).toBeCloseTo(48.5, 12);
    expect(() => parseAsciiGrid('hello')).toThrow(/header/);
    expect(() => parseAsciiGrid('ncols 3\nnrows 1\nxllcorner 8\nyllcorner 48\ncellsize 1\n1 2\n')).toThrow(/expected 3/);
    expect(() => parseAsciiGrid('ncols 1\nnrows 1\nxllcorner 500000\nyllcorner 5300000\ncellsize 30\n1\n')).toThrow(/geographic/);
  });
});

describe('hybrid fuel grid: satellite vegetation, OSM barriers', () => {
  const g = grid(40, 40);
  const ll = (r: number, c: number) => {
    const b = g.bounds;
    return { lat: b.north - ((r + 0.5) / g.height) * (b.north - b.south), lon: b.west + ((c + 0.5) / g.width) * (b.east - b.west) };
  };
  const base = new Uint8Array(40 * 40).fill(FuelClass.FOREST_CONIFER);
  const lake: OsmElement = { type: 'way', id: 1, tags: { natural: 'water' }, geometry: [ll(5, 5), ll(5, 12), ll(12, 12), ll(12, 5), ll(5, 5)] };
  const road: OsmElement = { type: 'way', id: 2, tags: { highway: 'primary' }, geometry: [ll(0, 30), ll(39, 30)] };
  const meadow: OsmElement = { type: 'way', id: 3, tags: { landuse: 'meadow' }, geometry: [ll(20, 5), ll(20, 15), ll(30, 15), ll(30, 5), ll(20, 5)] };

  it('draws OSM water and roads over the satellite base, keeps the base elsewhere, and does not mutate it', () => {
    const { fuel } = buildFuelGrid([lake, road], g, { baseFuel: base, vegetationFromOsm: false });
    expect(fuel[8 * 40 + 8]).toBe(FuelClass.NONE);
    expect(fuel[20 * 40 + 30]).toBe(FuelClass.NONE);
    expect(fuel[20 * 40 + 20]).toBe(FuelClass.FOREST_CONIFER);
    expect(base.every((v) => v === FuelClass.FOREST_CONIFER)).toBe(true);
  });

  it('OSM vegetation is skipped when the satellite supplies it, and drawn when asked', () => {
    expect(buildFuelGrid([meadow], g, { baseFuel: base, vegetationFromOsm: false }).fuel[25 * 40 + 10]).toBe(FuelClass.FOREST_CONIFER);
    expect(buildFuelGrid([meadow], g, { baseFuel: base, vegetationFromOsm: true }).fuel[25 * 40 + 10]).toBe(FuelClass.GRASS);
    expect(buildFuelGrid([meadow], g).fuel[25 * 40 + 10]).toBe(FuelClass.GRASS); // old behaviour unchanged
    expect(buildFuelGrid([], g).fuel[0]).toBe(FuelClass.GRASS); // default fuel unchanged
  });

  it('rejects a base grid of the wrong size', () => {
    expect(() => buildFuelGrid([], g, { baseFuel: new Uint8Array(10) })).toThrow(/baseFuel has 10 cells/);
  });
});
