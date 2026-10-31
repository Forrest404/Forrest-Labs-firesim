/**
 * Reading categorical land-cover rasters for the demo-area builder (Node only; `geotiff` is a dev
 * dependency and never enters the browser bundle).
 *
 *   readWorldCoverWindow  ESA WorldCover v200 straight from AWS (Cloud-Optimized GeoTIFF: only the
 *                         blocks that cover the window are downloaded), stitching 3-degree tiles
 *   readGeoTiffWindow     any local or in-memory GeoTIFF in geographic coordinates (EPSG:4326)
 *   parseAsciiGrid        ESRI ASCII grid text (gdal_translate -of AAIGrid), geographic degrees
 *
 * Reproject other rasters first, e.g. CORINE (EPSG:3035):  gdalwarp -t_srs EPSG:4326 clc.tif clc4326.tif
 */

import { fromFile, fromUrl } from 'geotiff';
import type { GeoTIFF } from 'geotiff';
import type { GridBounds } from '../../src/contract';
import { WORLDCOVER_BASE_URL, worldCoverTileName } from '../../src/data/landcover';
import type { SourceRaster } from '../../src/data/landcover';

/** Reads the part of a geographic GeoTIFF that covers `bounds` (plus a one pixel margin) as a SourceRaster. */
export async function readGeoTiffWindow(tiff: GeoTIFF, bounds: GridBounds): Promise<SourceRaster | null> {
  const img = await tiff.getImage();
  const keys = img.getGeoKeys() as Record<string, unknown> | null;
  const epsg = keys?.GeographicTypeGeoKey;
  if (epsg !== 4326) {
    throw new Error(`The raster is not in geographic WGS84 (EPSG:4326; GeographicTypeGeoKey = ${String(epsg)}). Reproject it first: gdalwarp -t_srs EPSG:4326 in.tif out.tif`);
  }
  const [ox, oy] = img.getOrigin();
  const [rx, ry] = img.getResolution(); // ry is negative for north-up rasters
  if (!(rx > 0) || !(ry < 0)) throw new Error('Only north-up rasters are supported');
  const W = img.getWidth();
  const H = img.getHeight();
  const x0 = Math.max(0, Math.floor((bounds.west - ox) / rx) - 1);
  const x1 = Math.min(W, Math.ceil((bounds.east - ox) / rx) + 1);
  const y0 = Math.max(0, Math.floor((bounds.north - oy) / ry) - 1);
  const y1 = Math.min(H, Math.ceil((bounds.south - oy) / ry) + 1);
  if (x1 <= x0 || y1 <= y0) return null; // the window does not overlap this raster
  const data = (await img.readRasters({ window: [x0, y0, x1, y1], samples: [0] })) as unknown as ArrayLike<number>[];
  return { data: data[0], width: x1 - x0, height: y1 - y0, west: ox + x0 * rx, north: oy + y0 * ry, pxLon: rx, pxLat: -ry };
}

/** Stitches several rasters that share one pixel lattice into one, zero (no data) where none covers. */
export function mosaic(parts: SourceRaster[]): SourceRaster {
  const { pxLon, pxLat } = parts[0];
  const west = Math.min(...parts.map((p) => p.west));
  const north = Math.max(...parts.map((p) => p.north));
  const east = Math.max(...parts.map((p) => p.west + p.width * pxLon));
  const south = Math.min(...parts.map((p) => p.north - p.height * pxLat));
  const width = Math.round((east - west) / pxLon);
  const height = Math.round((north - south) / pxLat);
  const data = new Uint16Array(width * height);
  for (const p of parts) {
    const ox = Math.round((p.west - west) / pxLon);
    const oy = Math.round((north - p.north) / pxLat);
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) data[(oy + y) * width + ox + x] = p.data[y * p.width + x];
  }
  return { data, width, height, west, north, pxLon, pxLat };
}

/** ESA WorldCover (2021, v200) for a bounding box, fetched window by window from AWS. */
export async function readWorldCoverWindow(bounds: GridBounds, log: (m: string) => void = () => undefined): Promise<SourceRaster> {
  const parts: SourceRaster[] = [];
  const seen = new Set<string>();
  for (const lon of [bounds.west, bounds.east]) {
    for (const lat of [bounds.south, bounds.north]) {
      const tile = worldCoverTileName(lon, lat);
      if (seen.has(tile.name)) continue;
      seen.add(tile.name);
      const url = WORLDCOVER_BASE_URL + tile.name;
      try {
        const t0 = Date.now();
        const part = await readGeoTiffWindow(await fromUrl(url), bounds);
        if (part) {
          parts.push(part);
          log(`  WorldCover ${tile.name}: ${part.width} x ${part.height} px in ${Date.now() - t0} ms`);
        }
      } catch (err) {
        // Ocean-only tiles do not exist in the bucket; treat a missing tile as "no data".
        log(`  WorldCover ${tile.name}: skipped (${err instanceof Error ? err.message : String(err)})`);
      }
    }
  }
  if (parts.length === 0) throw new Error('No WorldCover tile covers this area (open ocean, or the service is unreachable).');
  return mosaic(parts);
}

export async function readLocalGeoTiff(path: string, bounds: GridBounds): Promise<SourceRaster> {
  const r = await readGeoTiffWindow(await fromFile(path), bounds);
  if (!r) throw new Error(`${path} does not overlap the requested area`);
  return r;
}

/** ESRI ASCII grid in geographic degrees. */
export function parseAsciiGrid(text: string): SourceRaster {
  const lines = text.split(/\r?\n/);
  const head: Record<string, number> = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const m = /^\s*([A-Za-z_]+)\s+(-?[\d.eE+-]+)\s*$/.exec(lines[i]);
    if (!m) break;
    head[m[1].toLowerCase()] = Number(m[2]);
  }
  const ncols = head.ncols;
  const nrows = head.nrows;
  const cell = head.cellsize ?? head.dx;
  const cellY = head.cellsize ?? head.dy;
  if (!(ncols > 0 && nrows > 0 && cell > 0 && cellY > 0)) throw new Error('ASCII grid header is missing ncols, nrows or cellsize');
  const nodata = head.nodata_value ?? -9999;
  const xll = head.xllcorner ?? head.xllcenter - cell / 2;
  const yll = head.yllcorner ?? head.yllcenter - cellY / 2;
  if (!Number.isFinite(xll) || !Number.isFinite(yll)) throw new Error('ASCII grid header is missing xllcorner/yllcorner');
  if (Math.abs(xll) > 180 || Math.abs(yll) > 90) throw new Error('ASCII grid does not look like geographic degrees; reproject to EPSG:4326 first');
  const data = new Int32Array(ncols * nrows);
  for (let r = 0; r < nrows; r++) {
    const parts = (lines[i + r] ?? '').trim().split(/\s+/);
    if (parts.length < ncols) throw new Error(`ASCII grid row ${r} has ${parts.length} values, expected ${ncols}`);
    for (let c = 0; c < ncols; c++) {
      const v = Number(parts[c]);
      data[r * ncols + c] = v === nodata ? 0 : v;
    }
  }
  return { data, width: ncols, height: nrows, west: xll, north: yll + nrows * cellY, pxLon: cell, pxLat: cellY };
}
