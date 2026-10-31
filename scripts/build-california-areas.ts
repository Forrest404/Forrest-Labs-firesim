/**
 * Builds the California demo data from OSM extracts saved in scripts/data/:
 *   npm run build:california
 *
 * Overpass refuses scripted requests, so the OSM parts were fetched in overpass-turbo (a browser
 * tool, which Overpass allows) and rasterised onto the grids there with the same rules as
 * src/data/osm.ts. See data.md. This script only reads those files, plus elevation tiles.
 *
 * - boulder-creek: unmapped land becomes conifer instead of grass (the area is redwood forest;
 *   only OSM-mapped grassland stays grass), adds building counts per cell and a forest ignition
 *   1.2 km west of town.
 * - crozier: a new area around the 2024 Crozier Fire with its real perimeter and weather.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { ELEVATION_NODATA, FuelClass, cellAreaHa } from '../src/contract';
import { decodeBundle, encodeBundle, indexEntryFor } from '../src/data/bundle';
import type { DemoArea, DemoAreaBundle, DemoAreaIndex } from '../src/data/bundle';
import { lonLatToCell, lonLatToCellFloat, makeGridSpec } from '../src/data/geo';
import { fbfm40ToFuelClass, landfireExportUrl } from '../src/data/landfire';
import { rasterizePolygon } from '../src/data/raster';
import type { Pt } from '../src/data/raster';
import { decodeTerrariumTile, fillNodata, sampleElevationGrid, tileUrl, tilesForGrid } from '../src/data/terrain';

const OUT = 'public/demo-areas';
const DATA = 'scripts/data';
const OSM_NOTE = 'OSM fetched in overpass-turbo on 2026-10-31.';

/** "delta36[*count],..." -> per-cell building counts. */
function decodeHomes(encoded: string, n: number): Uint16Array {
  const homes = new Uint16Array(n);
  let idx = 0;
  for (const tok of encoded.split(',')) {
    const [delta, count] = tok.split('*');
    idx += parseInt(delta, 36);
    homes[idx] += count ? Number(count) : 1;
  }
  return homes;
}

/** Alternating run lengths, starting with 0s. */
function decodeMaskRle(encoded: string, n: number): Uint8Array {
  const mask = new Uint8Array(n);
  let i = 0;
  let v = 0;
  for (const run of encoded.split(',').map(Number)) {
    mask.fill(v, i, i + run);
    i += run;
    v ^= 1;
  }
  if (i !== n) throw new Error(`mask RLE covers ${i} cells, expected ${n}`);
  return mask;
}

/** "value:run,..." -> fuel grid. */
function decodeFuelRle(encoded: string, n: number): Uint8Array {
  const fuel = new Uint8Array(n);
  let i = 0;
  for (const tok of encoded.trim().split(',')) {
    const [v, run] = tok.split(':').map(Number);
    fuel.fill(v, i, i + run);
    i += run;
  }
  if (i !== n) throw new Error(`fuel RLE covers ${i} cells, expected ${n}`);
  return fuel;
}

const LANDFIRE_FUEL_LAYER = 'LF2023_FBFM40';

/** Raw LANDFIRE codes per cell (0 where there is no data), straight from the public ImageServer. */
async function landfireCodes(grid: ReturnType<typeof makeGridSpec>, layer: string): Promise<Uint8Array> {
  const res = await fetch(landfireExportUrl(layer, grid.bounds, grid.width, grid.height));
  if (!res.ok) throw new Error(`LANDFIRE ${layer}: HTTP ${res.status}`);
  const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
  if (png.width !== grid.width || png.height !== grid.height) throw new Error(`LANDFIRE ${layer}: got ${png.width}x${png.height}`);
  // Greyscale PNG decoded to RGBA: the code is in the red channel.
  return Uint8Array.from({ length: grid.width * grid.height }, (_, i) => png.data[i * 4]);
}

async function elevationFor(grid: ReturnType<typeof makeGridSpec>, zoom = 13): Promise<Float32Array> {
  const decoded = new Map<string, Float32Array>();
  for (const t of tilesForGrid(grid, zoom)) {
    const res = await fetch(tileUrl(zoom, t.x, t.y));
    if (!res.ok) throw new Error(`elevation tile ${t.x}/${t.y}: HTTP ${res.status}`);
    const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
    decoded.set(`${t.x}/${t.y}`, decodeTerrariumTile(png.data, png.width));
  }
  const elevation = sampleElevationGrid(grid, zoom, (x, y) => decoded.get(`${x}/${y}`));
  fillNodata(elevation, grid.width, grid.height, ELEVATION_NODATA);
  return elevation;
}

function readBundle(name: string): DemoArea {
  return decodeBundle(JSON.parse(readFileSync(join(OUT, `${name}.json`), 'utf8')) as DemoAreaBundle);
}

function writeBundle(area: DemoArea): void {
  writeFileSync(join(OUT, `${area.meta.name}.json`), JSON.stringify(encodeBundle(area)));
}

function boulderCreek(): DemoArea {
  const area = readBundle('boulder-creek');
  const n = area.grid.width * area.grid.height;
  const osm = JSON.parse(readFileSync(join(DATA, 'boulder-creek-osm.json'), 'utf8')) as { rle: string; homes: string };
  const mappedGrass = decodeMaskRle(osm.rle, n);
  let converted = 0;
  for (let i = 0; i < n; i++) {
    if (area.fuel[i] === FuelClass.GRASS && !mappedGrass[i]) {
      area.fuel[i] = FuelClass.FOREST_CONIFER;
      converted++;
    }
  }
  area.homes = decodeHomes(osm.homes, n);
  const ignition = lonLatToCell(area.grid, -122.1347, 37.1221);
  if (!ignition || area.fuel[ignition.row * area.grid.width + ignition.col] === FuelClass.NONE) throw new Error('boulder-creek ignition is not burnable');
  area.meta = {
    ...area.meta,
    description: `Real land cover (OpenStreetMap) and elevation (AWS Terrain Tiles) around 37.126, -122.122. Land without an OSM land-cover polygon is assumed to be conifer forest (redwoods). ${OSM_NOTE}`,
    suggestedIgnition: ignition,
    defaultWindFromDeg: 250,
  };
  const homes = area.homes.reduce((a, b) => a + b, 0);
  console.log(`boulder-creek: ${converted} unmapped cells grass -> conifer, ${homes} buildings, ignition`, ignition);
  return area;
}

async function crozier(): Promise<DemoArea> {
  const grid = makeGridSpec({ centerLon: -120.68995, centerLat: 38.83855, width: 200, height: 200, cellSizeM: 30 });
  const n = grid.width * grid.height;
  // Real pre-fire fuel: LANDFIRE 2023 (the fire was Aug 2024). OSM barely maps this box (99.6 %
  // unmapped), so OSM's land cover is kept only where LANDFIRE has no data.
  const osmFuel = decodeFuelRle(readFileSync(join(DATA, 'crozier-fuel-rle.txt'), 'utf8'), n);
  const codes = await landfireCodes(grid, LANDFIRE_FUEL_LAYER);
  const fuel = Uint8Array.from(codes, (code, i) => (code ? fbfm40ToFuelClass(code) : osmFuel[i]));
  const elevation = await elevationFor(grid);

  const geo = JSON.parse(readFileSync(join(DATA, 'crozier-perimeter.geojson'), 'utf8')) as {
    features: { properties: { poly_GISAcres: number }; geometry: { type: string; coordinates: number[][][][] } }[];
  };
  const f = geo.features[0];
  const polys = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates as unknown as number[][][]];
  const rings = polys.flat().map((ring) => ring.map(([lon, lat]) => [lon, lat] as [number, number]));
  const mask = new Uint8Array(n);
  const cellRings: Pt[][] = rings.map((ring) => ring.map(([lon, lat]) => {
    const { x, y } = lonLatToCellFloat(grid, lon, lat);
    return [x, y] as const;
  }));
  rasterizePolygon(mask, grid.width, grid.height, cellRings, 1);
  const maskCells = mask.reduce((a, b) => a + b, 0);
  const areaHa = f.properties.poly_GISAcres * 0.404686;

  const ignition = lonLatToCell(grid, -120.697385, 38.828893);
  if (!ignition) throw new Error('crozier ignition outside the grid');
  const area: DemoArea = {
    meta: {
      name: 'crozier',
      label: 'Crozier Fire 2024, CA (real-fire test)',
      synthetic: false,
      description: 'Real pre-fire fuel (LANDFIRE 2023, Scott & Burgan 40 fuel models) and elevation (AWS Terrain Tiles) around the 2024 Crozier Fire, El Dorado County. Simulated with the Rothermel spread model.',
      source: 'scripts/build-california-areas.ts',
      attribution: [
        'Fuel: LANDFIRE 2023 FBFM40, USGS/USDA (public domain)',
        '© OpenStreetMap contributors (ODbL)',
        'Elevation: AWS Terrain Tiles (Mapzen Terrarium), sources per https://registry.opendata.aws/terrain-tiles/',
        'Fire perimeter: NIFC WFIGS Interagency Perimeters (public domain)',
        'Weather: Open-Meteo archive (CC BY 4.0)',
      ],
      license: 'ODbL for OSM-derived land cover; see data/README.md',
      createdAt: new Date().toISOString(),
      suggestedIgnition: ignition,
      defaultWindFromDeg: 225,
      // Open-Meteo archive at the ignition point, afternoons of 6-8 Aug 2024: ~35 C, ~10 % RH, ~13 km/h from SW.
      defaultWeather: { windSpeedMps: 13 / 3.6, windFromDeg: 225, temperatureC: 35, relativeHumidity: 0.1, baseFuelMoisture: 0.04 },
      // Real fuel models plus the Rothermel equations: 67 % match vs 63 % for OSM + factors (data.md).
      defaultSettings: { rateModel: 'rothermel' },
      defaultDurationSeconds: 24 * 3600,
    },
    grid,
    fuel,
    elevation,
    reference: {
      name: 'Crozier Fire',
      summary: 'Started 6 Aug 2024 near Mosquito, El Dorado County. Final perimeter from NIFC.',
      source: 'NIFC WFIGS Interagency Perimeters',
      areaHa,
      mask,
      rings,
    },
  };
  console.log(`crozier: perimeter ${areaHa.toFixed(0)} ha (${maskCells} cells = ${(maskCells * cellAreaHa(grid)).toFixed(0)} ha), ignition`, ignition);
  return area;
}

async function main(): Promise<void> {
  const bc = boulderCreek();
  const cz = await crozier();
  writeBundle(bc);
  writeBundle(cz);

  const indexPath = join(OUT, 'index.json');
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as DemoAreaIndex;
  const rest = index.areas.filter((a) => a.name !== bc.meta.name && a.name !== cz.meta.name);
  index.areas = [indexEntryFor(bc), indexEntryFor(cz), ...rest];
  writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
  console.log('wrote boulder-creek.json, crozier.json and index.json (California first)');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
