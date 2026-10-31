/**
 * Builds a REAL demo-area bundle from open data for a bounding box centred on a point.
 *   npm run build:demo-area -- --name boulder-creek --label "Boulder Creek, CA" --center -122.122,37.126
 * Options: --size 200 (cells per side), --cell 30 (metres), --zoom 13 (elevation tiles),
 *          --out public/demo-areas, --wind 250 (default wind-from degrees for the area),
 *          --default GRASS (fuel for land with no OSM land-cover polygon: GRASS, SHRUB,
 *          FOREST_CONIFER, FOREST_DECIDUOUS, FARMLAND)
 *
 * Sources: OpenStreetMap via Overpass (ODbL) for land cover, AWS Terrain Tiles (Terrarium) for
 * elevation. Google tiles are never used as a data source.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { ELEVATION_NODATA, FuelClass } from '../src/contract';
import { encodeBundle, indexEntryFor } from '../src/data/bundle';
import type { DemoArea, DemoAreaIndex } from '../src/data/bundle';
import { makeGridSpec } from '../src/data/geo';
import { buildFuelGrid, overpassQuery } from '../src/data/osm';
import type { OsmElement } from '../src/data/osm';
import { decodeTerrariumTile, fillNodata, sampleElevationGrid, tileUrl, tilesForGrid } from '../src/data/terrain';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
];

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctl.signal, headers: { 'User-Agent': 'firesim-demo-area-builder/0.1', ...(init.headers ?? {}) } });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOverpass(query: string): Promise<OsmElement[]> {
  let lastErr: unknown;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      console.log(`Overpass: ${endpoint}`);
      const res = await fetchWithTimeout(endpoint, { method: 'POST', body: `data=${encodeURIComponent(query)}`, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 45_000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { elements: OsmElement[] };
      console.log(`  ${json.elements.length} elements`);
      return json.elements;
    } catch (err) {
      lastErr = err;
      console.warn(`  failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`All Overpass endpoints failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

async function main(): Promise<void> {
  const name = arg('name');
  const label = arg('label', name);
  const [lonS, latS] = arg('center').split(',');
  const centerLon = Number(lonS);
  const centerLat = Number(latS);
  const size = Number(arg('size', '200'));
  const cellSizeM = Number(arg('cell', '30'));
  const zoom = Number(arg('zoom', '13'));
  const outDir = resolve(process.cwd(), arg('out', 'public/demo-areas')); // resolve: absolute --out stays absolute
  const windFromDeg = Number(arg('wind', '250'));
  const defaultName = arg('default', 'GRASS').toUpperCase();
  const defaultFuel = FuelClass[defaultName as keyof typeof FuelClass];
  if (defaultFuel === undefined || defaultFuel === FuelClass.NONE) throw new Error(`--default must be a burnable FuelClass name, got ${defaultName}`);
  if (!Number.isFinite(centerLon) || !Number.isFinite(centerLat)) throw new Error('--center must be lon,lat');

  const grid = makeGridSpec({ centerLon, centerLat, width: size, height: size, cellSizeM });
  console.log(`Grid ${size}x${size} @ ${cellSizeM} m, bounds`, grid.bounds);

  // Elevation first: it is the more reliable service.
  const tiles = tilesForGrid(grid, zoom);
  console.log(`Elevation: ${tiles.length} Terrarium tiles at z${zoom}`);
  const decoded = new Map<string, Float32Array>();
  for (const t of tiles) {
    const url = tileUrl(zoom, t.x, t.y);
    const res = await fetchWithTimeout(url, {}, 20_000);
    if (!res.ok) {
      console.warn(`  missing tile ${url} (${res.status})`);
      continue;
    }
    const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
    decoded.set(`${t.x}/${t.y}`, decodeTerrariumTile(png.data, png.width));
  }
  const elevation = sampleElevationGrid(grid, zoom, (x, y) => decoded.get(`${x}/${y}`));
  const filled = fillNodata(elevation, grid.width, grid.height, ELEVATION_NODATA);
  if (filled > 0) console.warn(`  filled ${filled} nodata cells`);

  const elements = await fetchOverpass(overpassQuery(grid.bounds));
  const { fuel, stats } = buildFuelGrid(elements, grid, { defaultFuel });
  console.log('Fuel stats', stats, `default=${defaultName}`);

  const area: DemoArea = {
    meta: {
      name,
      label,
      synthetic: false,
      description: `Real land cover (OpenStreetMap) and elevation (AWS Terrain Tiles) around ${centerLat.toFixed(3)}, ${centerLon.toFixed(3)}. Land without an OSM land-cover polygon is assumed to be ${defaultName.toLowerCase().replace('_', ' ')}.`,
      source: 'scripts/build-demo-area.ts',
      attribution: ['© OpenStreetMap contributors (ODbL)', 'Elevation: AWS Terrain Tiles (Mapzen Terrarium), sources per https://registry.opendata.aws/terrain-tiles/'],
      license: 'ODbL for OSM-derived land cover; see data/README.md',
      createdAt: new Date().toISOString(),
      defaultWindFromDeg: windFromDeg,
    },
    grid,
    fuel,
    elevation,
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(encodeBundle(area)));
  const indexPath = join(outDir, 'index.json');
  const index: DemoAreaIndex = existsSync(indexPath) ? (JSON.parse(readFileSync(indexPath, 'utf8')) as DemoAreaIndex) : { version: 1, areas: [] };
  index.areas = index.areas.filter((a) => a.name !== name);
  index.areas.unshift(indexEntryFor(area));
  writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
  console.log(`wrote ${name}.json and updated index.json`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
