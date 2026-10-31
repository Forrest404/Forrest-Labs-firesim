/**
 * "Predict a live fire": fires reported now (NIFC WFIGS current incidents), and a demo area built
 * in the browser around one of them from open data, no keys:
 *   fuel      LANDFIRE FBFM40 (USGS/USDA ImageServer), mapped in landfire.ts
 *   terrain   AWS Terrain Tiles (Terrarium)
 *   weather   Open-Meteo current conditions at the fire
 * The ignition is the reported incident point: a fire's current perimeter is usually not public
 * yet, so the forecast starts from a point. Simplified model, not for real-world decisions.
 */

import { ELEVATION_NODATA, FuelClass, deriveFuelMoisture } from '../contract';
import type { CellRef, Weather } from '../contract';
import type { DemoArea } from './bundle';
import { lonLatToCell, makeGridSpec } from './geo';
import { fbfm40ToFuelClass, landfireExportUrl } from './landfire';
import { decodeTerrariumTile, fillNodata, sampleElevationGrid, tileUrl, tilesForGrid } from './terrain';

export interface LiveFire {
  id: string;
  name: string;
  lat: number;
  lon: number;
  acres: number | null;
  containedPct: number | null;
  /** Discovery time, ms since epoch. */
  discovered: number;
}

const INCIDENTS_URL = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query';
const LIVE_FUEL_LAYER = 'LF2024_FBFM40';
const GRID_CELLS = 200;
const CELL_M = 30;
const TERRAIN_ZOOM = 13;

/** Wildfires reported in a US state now, newest first. */
export async function fetchLiveFires(state = 'US-CA', limit = 8, fetchImpl: typeof fetch = fetch): Promise<LiveFire[]> {
  const params = new URLSearchParams({
    where: `POOState='${state}' AND IncidentTypeCategory='WF'`,
    outFields: 'UniqueFireIdentifier,IncidentName,IncidentSize,PercentContained,FireDiscoveryDateTime',
    orderByFields: 'FireDiscoveryDateTime DESC',
    resultRecordCount: String(limit),
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
  });
  const res = await fetchImpl(`${INCIDENTS_URL}?${params}`);
  if (!res.ok) throw new Error(`NIFC incidents: HTTP ${res.status}`);
  const data = (await res.json()) as { features?: { attributes: Record<string, unknown>; geometry?: { x: number; y: number } }[]; error?: { message: string } };
  if (data.error) throw new Error(`NIFC incidents: ${data.error.message}`);
  return (data.features ?? [])
    .filter((f) => f.geometry && Number.isFinite(f.geometry.x) && Number.isFinite(f.geometry.y))
    .map((f) => {
      const a = f.attributes;
      return {
        id: String(a.UniqueFireIdentifier ?? `${f.geometry!.x},${f.geometry!.y}`),
        name: String(a.IncidentName ?? 'Unnamed fire'),
        lat: f.geometry!.y,
        lon: f.geometry!.x,
        acres: typeof a.IncidentSize === 'number' ? a.IncidentSize : null,
        containedPct: typeof a.PercentContained === 'number' ? a.PercentContained : null,
        discovered: Number(a.FireDiscoveryDateTime ?? 0),
      };
    });
}

/** Current weather at a point from Open-Meteo, as the app's Weather. */
export async function fetchCurrentWeather(lat: number, lon: number, fetchImpl: typeof fetch = fetch): Promise<Partial<Weather>> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Open-Meteo: HTTP ${res.status}`);
  const c = ((await res.json()) as { current: { temperature_2m: number; relative_humidity_2m: number; wind_speed_10m: number; wind_direction_10m: number } }).current;
  const rh = c.relative_humidity_2m / 100;
  return {
    temperatureC: c.temperature_2m,
    relativeHumidity: rh,
    windSpeedMps: c.wind_speed_10m,
    windFromDeg: c.wind_direction_10m,
    baseFuelMoisture: deriveFuelMoisture(c.temperature_2m, rh),
  };
}

/** Decodes an image URL to RGBA pixels in the browser (the servers send CORS headers). */
async function imagePixels(url: string): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status}`);
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(bmp, 0, 0);
  return { data: ctx.getImageData(0, 0, bmp.width, bmp.height).data, width: bmp.width, height: bmp.height };
}

/**
 * The cell nearest to `start` that sits in real wildland: burnable, with most of the 7 x 7 cells
 * around it burnable too. Incident points are often on a road or in town, and a lone patch of
 * grass between houses would let the fire go nowhere. Falls back to any burnable cell.
 */
export function nearestBurnable(fuel: Uint8Array, width: number, height: number, start: CellRef, minShare = 0.6): CellRef | null {
  const wild = (row: number, col: number): boolean => {
    let burnable = 0;
    let total = 0;
    for (let dr = -3; dr <= 3; dr++) {
      for (let dc = -3; dc <= 3; dc++) {
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || c < 0 || r >= height || c >= width) continue;
        total++;
        if (fuel[r * width + c] !== FuelClass.NONE) burnable++;
      }
    }
    return burnable >= minShare * total;
  };
  let fallback: CellRef | null = null;
  for (let r = 0; r < Math.max(width, height); r++) {
    for (let dr = -r; dr <= r; dr++) {
      for (let dc = -r; dc <= r; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== r) continue;
        const row = start.row + dr;
        const col = start.col + dc;
        if (row < 0 || col < 0 || row >= height || col >= width) continue;
        if (fuel[row * width + col] === FuelClass.NONE) continue;
        if (wild(row, col)) return { row, col };
        fallback ??= { row, col };
      }
    }
  }
  return fallback;
}

export async function buildLiveArea(fire: LiveFire): Promise<DemoArea> {
  const grid = makeGridSpec({ centerLon: fire.lon, centerLat: fire.lat, width: GRID_CELLS, height: GRID_CELLS, cellSizeM: CELL_M });
  const n = grid.width * grid.height;

  const [fuelPx, weather, elevation] = await Promise.all([
    imagePixels(landfireExportUrl(LIVE_FUEL_LAYER, grid.bounds, grid.width, grid.height)),
    fetchCurrentWeather(fire.lat, fire.lon),
    (async () => {
      const tiles = new Map<string, Float32Array>();
      await Promise.all(tilesForGrid(grid, TERRAIN_ZOOM).map(async (t) => {
        const px = await imagePixels(tileUrl(TERRAIN_ZOOM, t.x, t.y));
        tiles.set(`${t.x}/${t.y}`, decodeTerrariumTile(px.data, px.width));
      }));
      const elev = sampleElevationGrid(grid, TERRAIN_ZOOM, (x, y) => tiles.get(`${x}/${y}`));
      fillNodata(elev, grid.width, grid.height, ELEVATION_NODATA);
      return elev;
    })(),
  ]);
  if (fuelPx.width !== grid.width || fuelPx.height !== grid.height) throw new Error('LANDFIRE returned an unexpected size');
  // Greyscale codes decode to RGBA with the code in every colour channel.
  const fuel = Uint8Array.from({ length: n }, (_, i) => fbfm40ToFuelClass(fuelPx.data[i * 4]));

  const point = lonLatToCell(grid, fire.lon, fire.lat) ?? { row: grid.height >> 1, col: grid.width >> 1 };
  const ignition = nearestBurnable(fuel, grid.width, grid.height, point);
  if (!ignition) throw new Error(`No burnable fuel around ${fire.name} in LANDFIRE`);
  const when = fire.discovered ? new Date(fire.discovered).toLocaleString() : 'recently';
  return {
    meta: {
      name: `live-${fire.id}`,
      label: `Live: ${fire.name}`,
      synthetic: false,
      description: `${fire.name}, reported ${when} (NIFC). Fuel LANDFIRE 2024, terrain AWS Terrain Tiles, current weather Open-Meteo. The forecast starts from the reported point.`,
      source: 'src/data/liveFire.ts (built in the browser)',
      attribution: [
        'Incident: NIFC WFIGS (public domain)',
        'Fuel: LANDFIRE 2024 FBFM40, USGS/USDA (public domain)',
        'Elevation: AWS Terrain Tiles (Mapzen Terrarium)',
        'Weather: Open-Meteo (CC BY 4.0)',
      ],
      license: 'Public domain and CC BY 4.0 sources; see attribution',
      createdAt: new Date().toISOString(),
      suggestedIgnition: ignition,
      defaultWindFromDeg: weather.windFromDeg,
      defaultWeather: weather,
      defaultSettings: { rateModel: 'rothermel' },
      defaultDurationSeconds: 6 * 3600,
    },
    grid,
    fuel,
    elevation,
  };
}
