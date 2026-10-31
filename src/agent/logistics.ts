/**
 * AGENT 1 — Logistics, Overpass Station Discovery, OSRM Road Routing & River Dip-Site Finder.
 * Pure geospatial & data module (no DOM, no Cesium imports).
 */

import { FuelClass } from '../contract';
import type { CellRef, GridSpec } from '../contract';
import type { DemoArea } from '../data/bundle';
import { cellCenterLonLat, gridCenter, lonLatToCellFloat } from '../data/geo';
import type { DipSite, FireStationAsset, UnitType } from './types';

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance between two lon/lat points in kilometres. */
export function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Clamps an external lon/lat station coordinate to the nearest cell on the grid perimeter. */
export function closestPerimeterEntry(grid: GridSpec, lon: number, lat: number): {
  cell: CellRef;
  lonLat: { lon: number; lat: number };
} {
  const { x, y } = lonLatToCellFloat(grid, lon, lat);
  const col = Math.max(0, Math.min(grid.width - 1, Math.round(x)));
  const row = Math.max(0, Math.min(grid.height - 1, Math.round(y)));
  return {
    cell: { row, col },
    lonLat: cellCenterLonLat(grid, row, col),
  };
}

interface RawStationSeed {
  id: string;
  name: string;
  unitType: UnitType;
  lon: number;
  lat: number;
  source: 'overpass' | 'fallback';
}

/** Average wildland/municipal fire truck transit speed (55 km/h / ~34 mph). */
export const AVERAGE_FIRE_TRUCK_SPEED_KMH = 55;

/** Average wildland/municipal fire truck water tank capacity (2,500 L / ~660 US gal). */
export const AVERAGE_FIRE_TRUCK_WATER_LITERS = 2500;

const UNIT_DEFAULTS: Record<
  UnitType,
  {
    speedKmh: number;
    waterCapacityLiters: number;
    waterRadiusCells: number;
    dropLengthCells: number;
    moistureBoost: number;
    halfLifeS: number;
    turnaroundSeconds: number;
    turnoutSeconds: number;
  }
> = {
  engine: {
    speedKmh: AVERAGE_FIRE_TRUCK_SPEED_KMH,
    waterCapacityLiters: AVERAGE_FIRE_TRUCK_WATER_LITERS,
    waterRadiusCells: 2,
    dropLengthCells: 12,
    moistureBoost: 0.65,
    halfLifeS: 1200,
    turnaroundSeconds: 540, // 9 min hydrant/tender hose reposition
    turnoutSeconds: 90,
  },
  helicopter: {
    speedKmh: AVERAGE_FIRE_TRUCK_SPEED_KMH,
    waterCapacityLiters: AVERAGE_FIRE_TRUCK_WATER_LITERS,
    waterRadiusCells: 2,
    dropLengthCells: 12,
    moistureBoost: 0.65,
    halfLifeS: 1200,
    turnaroundSeconds: 360, // 6 min dip-site turnaround
    turnoutSeconds: 90,
  },
  airtanker: {
    speedKmh: AVERAGE_FIRE_TRUCK_SPEED_KMH,
    waterCapacityLiters: AVERAGE_FIRE_TRUCK_WATER_LITERS,
    waterRadiusCells: 2,
    dropLengthCells: 12,
    moistureBoost: 0.65,
    halfLifeS: 1200,
    turnaroundSeconds: 900, // 15 min tender reload
    turnoutSeconds: 120,
  },
};

/**
 * Curated realistic stations for Boulder Creek (Santa Cruz Mountains, CA),
 * Alpirsbach (Black Forest, DE), and synthetic demo areas.
 */
export function getFallbackStationSeeds(areaName: string, grid: GridSpec): RawStationSeed[] {
  const center = gridCenter(grid);
  const isBoulder = areaName.includes('boulder') || center.lon < -100;

  if (isBoulder) {
    return [
      {
        id: 'stn-boulder-eng1',
        name: 'Boulder Creek FD Engine 3712',
        unitType: 'engine',
        lon: center.lon - 0.014,
        lat: center.lat - 0.012,
        source: 'fallback',
      },
      {
        id: 'stn-felton-eng2',
        name: 'Felton Fire Protection Engine 2310',
        unitType: 'engine',
        lon: center.lon + 0.042,
        lat: center.lat - 0.058,
        source: 'fallback',
      },
      {
        id: 'stn-benlomond-eng3',
        name: 'Ben Lomond Fire Engine 2211',
        unitType: 'engine',
        lon: center.lon + 0.026,
        lat: center.lat - 0.036,
        source: 'fallback',
      },
      {
        id: 'stn-alma-heli1',
        name: 'CalFire Alma Helitack H-106',
        unitType: 'helicopter',
        lon: center.lon + 0.115,
        lat: center.lat + 0.045,
        source: 'fallback',
      },
      {
        id: 'stn-hollister-tanker1',
        name: 'Hollister Air Attack Tanker T-910',
        unitType: 'airtanker',
        lon: center.lon + 0.38,
        lat: center.lat - 0.24,
        source: 'fallback',
      },
    ];
  }

  return [
    {
      id: 'stn-alpirsbach-eng1',
      name: 'Feuerwehr Alpirsbach LF-20',
      unitType: 'engine',
      lon: center.lon - 0.011,
      lat: center.lat - 0.009,
      source: 'fallback',
    },
    {
      id: 'stn-schiltach-eng2',
      name: 'Feuerwehr Schiltach TLF-3000',
      unitType: 'engine',
      lon: center.lon - 0.052,
      lat: center.lat - 0.055,
      source: 'fallback',
    },
    {
      id: 'stn-freudenstadt-eng3',
      name: 'Feuerwehr Freudenstadt Engine 1',
      unitType: 'engine',
      lon: center.lon + 0.018,
      lat: center.lat + 0.11,
      source: 'fallback',
    },
    {
      id: 'stn-schwarzwald-heli1',
      name: 'DRF Helitack Christoph 11',
      unitType: 'helicopter',
      lon: center.lon + 0.12,
      lat: center.lat - 0.14,
      source: 'fallback',
    },
    {
      id: 'stn-baden-tanker1',
      name: 'Baden-Airpark Airtanker T-44',
      unitType: 'airtanker',
      lon: center.lon - 0.28,
      lat: center.lat + 0.36,
      source: 'fallback',
    },
  ];
}

/**
 * Queries OpenStreetMap Overpass API for real fire stations and helipads within ~22 km.
 * Returns null if offline, timed out, or zero results.
 */
export async function fetchOverpassStationSeeds(
  grid: GridSpec,
  timeoutMs = 5000,
): Promise<RawStationSeed[] | null> {
  if (typeof fetch === 'undefined') return null;
  const center = gridCenter(grid);
  const dLat = 0.18;
  const dLon = 0.24;
  const s = (center.lat - dLat).toFixed(4);
  const w = (center.lon - dLon).toFixed(4);
  const n = (center.lat + dLat).toFixed(4);
  const e = (center.lon + dLon).toFixed(4);

  const query = `[out:json][timeout:5];(node["amenity"="fire_station"](${s},${w},${n},${e});way["amenity"="fire_station"](${s},${w},${n},${e});node["aeroway"~"helipad|aerodrome"](${s},${w},${n},${e}););out center 12;`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      elements?: {
        id: number;
        lat?: number;
        lon?: number;
        center?: { lat: number; lon: number };
        tags?: Record<string, string>;
      }[];
    };
    if (!data.elements || data.elements.length === 0) return null;

    const seeds: RawStationSeed[] = [];
    for (const el of data.elements) {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (lat === undefined || lon === undefined) continue;
      const aeroway = el.tags?.aeroway;
      const unitType: UnitType =
        aeroway === 'aerodrome' ? 'airtanker' : aeroway === 'helipad' ? 'helicopter' : 'engine';
      const rawName =
        el.tags?.name ??
        (unitType === 'engine'
          ? `OSM Fire Station #${el.id % 1000}`
          : unitType === 'helicopter'
            ? `OSM Helipad #${el.id % 1000}`
            : `OSM Airfield #${el.id % 1000}`);
      seeds.push({
        id: `osm-${el.id}`,
        name: rawName,
        unitType,
        lon,
        lat,
        source: 'overpass',
      });
    }
    return seeds.length >= 2 ? seeds : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const CREW_PERSONA_ROSTER: ReadonlyArray<{
  crewLeadName: string;
  stationNumber: string;
  voicePreset: 'Kore' | 'Fenrir' | 'Puck' | 'Charon';
  voicePitch: number;
  voiceRate: number;
}> = [
  { crewLeadName: 'Sarah Miller', stationNumber: '14', voicePreset: 'Kore', voicePitch: 1.08, voiceRate: 1.1 },
  { crewLeadName: 'Mike Vance', stationNumber: '4', voicePreset: 'Fenrir', voicePitch: 0.9, voiceRate: 1.12 },
  { crewLeadName: 'Dan Brooks', stationNumber: '23', voicePreset: 'Charon', voicePitch: 0.84, voiceRate: 1.07 },
  { crewLeadName: 'Elena Reyes', stationNumber: '8', voicePreset: 'Puck', voicePitch: 1.14, voiceRate: 1.13 },
  { crewLeadName: 'Marcus Cole', stationNumber: '19', voicePreset: 'Fenrir', voicePitch: 0.95, voiceRate: 1.09 },
  { crewLeadName: 'Hannah Cho', stationNumber: '11', voicePreset: 'Kore', voicePitch: 1.04, voiceRate: 1.12 },
];

export function assignStationCrewPersona(
  stationId: string,
  stationName: string,
  unitType: UnitType,
  index = 0,
): NonNullable<FireStationAsset['crewPersona']> {
  let hash = index;
  for (let i = 0; i < stationId.length; i++) {
    hash = (hash * 31 + stationId.charCodeAt(i)) >>> 0;
  }
  const slot = CREW_PERSONA_ROSTER[hash % CREW_PERSONA_ROSTER.length];
  // Extract an explicit station/unit number from name if present, otherwise use roster stationNumber
  const numMatch = stationName.match(/\b(\d{1,4})\b/);
  const stnNum = numMatch ? numMatch[1] : slot.stationNumber;
  const stationCallLabel =
    unitType === 'helicopter'
      ? `Station ${stnNum} Helibase`
      : unitType === 'airtanker'
        ? `Station ${stnNum} Air Attack`
        : `Station ${stnNum}`;
  const callsign =
    unitType === 'helicopter'
      ? `Helitack ${stnNum}`
      : unitType === 'airtanker'
        ? `Tanker ${stnNum}`
        : `Engine ${stnNum}`;

  return {
    crewLeadName: slot.crewLeadName,
    stationCallLabel,
    callsign,
    voicePreset: slot.voicePreset,
    voicePitch: slot.voicePitch,
    voiceRate: slot.voiceRate,
  };
}

/** Generates a realistic winding road polyline between two lon/lat points when offline. */
export function buildCurvedRoadWaypoints(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
  segments = 10,
): [number, number][] {
  const pts: [number, number][] = [];
  const dLon = lon2 - lon1;
  const dLat = lat2 - lat1;
  // Perpendicular vector for realistic mountain switchback / road curvature
  const pLon = -dLat * 0.14;
  const pLat = dLon * 0.14;
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const wave = Math.sin(u * Math.PI * 2) * (1 - Math.abs(2 * u - 1)) * 0.65;
    pts.push([lon1 + dLon * u + pLon * wave, lat1 + dLat * u + pLat * wave]);
  }
  return pts;
}

/**
 * Queries OSRM driving route API for real road travel distance & duration for ground fire engines.
 * Falls back to 1.35x Euclidean road tortuosity factor at 55 km/h if offline or unreachable.
 */
export async function computeEngineTransit(
  fromLon: number,
  fromLat: number,
  toLon: number,
  toLat: number,
  speedKmh: number,
  turnoutSeconds: number,
  enableOsrmNetwork = true,
): Promise<{
  routeDistanceKm: number;
  travelTimeSeconds: number;
  routingMethod: 'osrm' | 'tortuosity';
  routeWaypointsLonLat: [number, number][];
}> {
  const straightKm = Math.max(0.4, haversineKm(fromLon, fromLat, toLon, toLat));

  if (enableOsrmNetwork && typeof fetch !== 'undefined') {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3200);
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${fromLon.toFixed(5)},${fromLat.toFixed(5)};${toLon.toFixed(5)},${toLat.toFixed(5)}?overview=simplified&geometries=geojson`;
      const res = await fetch(url, { signal: ctrl.signal });
      if (res.ok) {
        const json = (await res.json()) as {
          routes?: {
            distance?: number;
            duration?: number;
            geometry?: { coordinates?: [number, number][] };
          }[];
        };
        const route = json.routes?.[0];
        if (route && typeof route.distance === 'number' && typeof route.duration === 'number') {
          const roadKm = Math.max(straightKm, route.distance / 1000);
          // Emergency response vehicles travel ~15% faster than standard civilian OSRM profile
          const driveSeconds = Math.round(route.duration * 0.85) + turnoutSeconds;
          const coords = route.geometry?.coordinates;
          return {
            routeDistanceKm: Number(roadKm.toFixed(2)),
            travelTimeSeconds: Math.max(120, driveSeconds),
            routingMethod: 'osrm',
            routeWaypointsLonLat:
              coords && coords.length >= 2
                ? coords
                : buildCurvedRoadWaypoints(fromLon, fromLat, toLon, toLat),
          };
        }
      }
    } catch {
      // Fall through to tortuosity model
    } finally {
      clearTimeout(timer);
    }
  }

  // Tortuosity fallback: 1.35x winding factor on mountain/forest roads
  const roadKm = straightKm * 1.35;
  const driveSeconds = Math.round((roadKm / speedKmh) * 3600) + turnoutSeconds;
  return {
    routeDistanceKm: Number(roadKm.toFixed(2)),
    travelTimeSeconds: Math.max(120, driveSeconds),
    routingMethod: 'tortuosity',
    routeWaypointsLonLat: buildCurvedRoadWaypoints(fromLon, fromLat, toLon, toLat),
  };
}

/**
 * Converts a station seed into a complete FireStationAsset with OSRM/tortuosity or direct flight ETA.
 */
export async function hydrateStationAsset(
  seed: RawStationSeed,
  grid: GridSpec,
  enableOsrmNetwork = true,
  index = 0,
): Promise<FireStationAsset> {
  const center = gridCenter(grid);
  const distanceKm = Number(Math.max(0.4, haversineKm(seed.lon, seed.lat, center.lon, center.lat)).toFixed(2));
  const entry = closestPerimeterEntry(grid, seed.lon, seed.lat);
  const cfg = UNIT_DEFAULTS[seed.unitType];
  const crewPersona = assignStationCrewPersona(seed.id, seed.name, seed.unitType, index);

  if (seed.unitType === 'engine') {
    const transit = await computeEngineTransit(
      seed.lon,
      seed.lat,
      entry.lonLat.lon,
      entry.lonLat.lat,
      cfg.speedKmh,
      cfg.turnoutSeconds,
      enableOsrmNetwork,
    );
    return {
      id: seed.id,
      name: seed.name,
      unitType: seed.unitType,
      lon: seed.lon,
      lat: seed.lat,
      distanceKm,
      routeDistanceKm: transit.routeDistanceKm,
      speedKmh: cfg.speedKmh,
      waterCapacityLiters: cfg.waterCapacityLiters,
      travelTimeSeconds: transit.travelTimeSeconds,
      routingMethod: transit.routingMethod,
      entryCell: entry.cell,
      entryLonLat: entry.lonLat,
      routeWaypointsLonLat: transit.routeWaypointsLonLat,
      crewPersona,
      waterRadiusCells: cfg.waterRadiusCells,
      dropLengthCells: cfg.dropLengthCells,
      moistureBoost: cfg.moistureBoost,
      halfLifeS: cfg.halfLifeS,
      turnaroundSeconds: cfg.turnaroundSeconds,
      source: seed.source,
    };
  }

  // Helicopter or Airtanker: direct vector calibrated to average fire truck speed & water tank
  const flightSeconds = Math.round((distanceKm / cfg.speedKmh) * 3600) + cfg.turnoutSeconds;
  return {
    id: seed.id,
    name: seed.name,
    unitType: seed.unitType,
    lon: seed.lon,
    lat: seed.lat,
    distanceKm,
    routeDistanceKm: distanceKm,
    speedKmh: cfg.speedKmh,
    waterCapacityLiters: cfg.waterCapacityLiters,
    travelTimeSeconds: Math.max(150, flightSeconds),
    routingMethod: 'direct',
    entryCell: entry.cell,
    entryLonLat: entry.lonLat,
    routeWaypointsLonLat: [
      [entry.lonLat.lon, entry.lonLat.lat],
      [center.lon, center.lat],
    ],
    crewPersona,
    waterRadiusCells: cfg.waterRadiusCells,
    dropLengthCells: cfg.dropLengthCells,
    moistureBoost: cfg.moistureBoost,
    halfLifeS: cfg.halfLifeS,
    turnaroundSeconds: cfg.turnaroundSeconds,
    source: seed.source,
  };
}

/**
 * Discovers nearby fire stations, helitack bases, and airtanker bases for an area.
 * Ensures a balanced strike team (at least 2 engines, 1 helicopter, 1 airtanker).
 */
export async function discoverFireStations(
  area: DemoArea,
  options: { enableNetwork?: boolean } = {},
): Promise<FireStationAsset[]> {
  const enableNet = options.enableNetwork ?? !area.meta.synthetic;
  const fallbackSeeds = getFallbackStationSeeds(area.meta.name, area.grid);

  let seeds: RawStationSeed[] = fallbackSeeds;
  if (enableNet) {
    const osmSeeds = await fetchOverpassStationSeeds(area.grid);
    if (osmSeeds && osmSeeds.length > 0) {
      // Combine OSM stations with fallback aerial units if OSM only returned ground stations
      const hasHeli = osmSeeds.some((s) => s.unitType === 'helicopter');
      const hasTanker = osmSeeds.some((s) => s.unitType === 'airtanker');
      seeds = [
        ...osmSeeds.slice(0, 3),
        ...(hasHeli ? [] : fallbackSeeds.filter((s) => s.unitType === 'helicopter')),
        ...(hasTanker ? [] : fallbackSeeds.filter((s) => s.unitType === 'airtanker')),
      ];
    }
  }

  const assets = await Promise.all(
    seeds.map((s, idx) => hydrateStationAsset(s, area.grid, enableNet, idx)),
  );
  return assets.sort((a, b) => a.travelTimeSeconds - b.travelTimeSeconds);
}

/**
 * Scans the terrain grid for the best helicopter water-dipping site (river, lake, or valley water body).
 * Looks for clustered FuelClass.NONE cells at low local elevation (valley bottom rivers/ponds)
 * within practical shuttle distance of the ignition point.
 */
export function findBestDipSite(area: DemoArea, ignition: CellRef | null): DipSite | null {
  const { width, height, cellSizeM } = area.grid;
  const refRow = ignition ? ignition.row : Math.floor(height / 2);
  const refCol = ignition ? ignition.col : Math.floor(width / 2);

  // Find elevation range to identify valley bottoms where rivers/lakes sit
  let minElev = Number.POSITIVE_INFINITY;
  let maxElev = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < area.elevation.length; i++) {
    const e = area.elevation[i];
    if (e < minElev) minElev = e;
    if (e > maxElev) maxElev = e;
  }
  const elevSpan = Math.max(1, maxElev - minElev);

  let bestRow = -1;
  let bestCol = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  // Step by 2 cells for speed across 200x200
  for (let r = 4; r < height - 4; r += 2) {
    for (let c = 4; c < width - 4; c += 2) {
      const idx = r * width + c;
      if (area.fuel[idx] !== FuelClass.NONE) continue;

      // Count neighboring non-burnable cells in a 3x3 window (rivers/lakes have contiguous width)
      let waterNeighbors = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (area.fuel[(r + dr) * width + (c + dc)] === FuelClass.NONE) waterNeighbors++;
        }
      }
      if (waterNeighbors < 3) continue;

      const distCells = Math.hypot(r - refRow, c - refCol);
      // Avoid dipping right inside the immediate 6-cell ignition core, prefer 12-65 cells away
      if (distCells < 8) continue;

      const elevNorm = (area.elevation[idx] - minElev) / elevSpan;
      // Lower elevation + reasonable proximity to fire = best river/lake dip point
      const score = distCells * 0.8 + elevNorm * 65 - waterNeighbors * 2.5;
      if (score < bestScore) {
        bestScore = score;
        bestRow = r;
        bestCol = c;
      }
    }
  }

  if (bestRow < 0 || bestCol < 0) return null;

  const { lon, lat } = cellCenterLonLat(area.grid, bestRow, bestCol);
  const distMeters = Math.hypot(bestRow - refRow, bestCol - refCol) * cellSizeM;
  // Helicopter shuttle turnaround: 90s hover-dip + round-trip flight at 150 km/h (41.6 m/s)
  const turnaroundSeconds = Math.max(180, Math.min(480, Math.round(90 + (2 * distMeters) / 41.6)));

  const isBoulder = area.meta.name.includes('boulder');
  const isAlpirsbach = area.meta.name.includes('alpirsbach');
  const label = isBoulder
    ? 'San Lorenzo River Dip Site'
    : isAlpirsbach
      ? 'Kinzig River Dip Site'
      : 'Valley River Dip Site';

  return {
    row: bestRow,
    col: bestCol,
    lon,
    lat,
    label,
    turnaroundSeconds,
  };
}
