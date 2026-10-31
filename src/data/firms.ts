/**
 * NASA FIRMS active-fire detections: URL builder, CSV parser, filters and a coarse clustering
 * used for the "largest fires" list. Pure and Node-safe (no DOM, no Cesium, no fetch here).
 *
 * Each row is a satellite pixel that contained a heat source (VIIRS ~375 m, MODIS ~1 km), not a
 * fire perimeter. Near-real-time rows are typically 1-3 h behind the overpass.
 * API: https://firms.modaps.eosdis.nasa.gov/api/area/
 */

export type FirmsSource = 'VIIRS_NOAA20_NRT' | 'VIIRS_NOAA21_NRT' | 'VIIRS_SNPP_NRT' | 'MODIS_NRT';

/** UI-level source choice; 'viirs' fetches NOAA-20 and Suomi NPP together. */
export type LiveSource = 'viirs' | 'noaa20' | 'snpp' | 'modis';

export const SOURCE_SETS: Record<LiveSource, FirmsSource[]> = {
  viirs: ['VIIRS_NOAA20_NRT', 'VIIRS_SNPP_NRT'],
  noaa20: ['VIIRS_NOAA20_NRT'],
  snpp: ['VIIRS_SNPP_NRT'],
  modis: ['MODIS_NRT'],
};

export type Confidence = 'low' | 'nominal' | 'high';
export type Instrument = 'VIIRS' | 'MODIS';

export interface Hotspot {
  /** Deterministic per row: instrument, satellite, acquisition time and rounded position. */
  id: string;
  lat: number;
  lon: number;
  /** Fire radiative power, MW. */
  frp: number;
  /** Brightness temperature of the fire channel, K (VIIRS I-4 or MODIS 21/22). */
  brightness: number;
  confidence: Confidence;
  satellite: string;
  instrument: Instrument;
  /** Acquisition time, epoch milliseconds UTC. */
  acquiredAt: number;
  daynight: 'D' | 'N';
  /** Pixel size along scan / track, km. */
  scan: number;
  track: number;
}

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export const FIRMS_API_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';
export const FIRMS_KEY_URL = 'https://firms.modaps.eosdis.nasa.gov/api/map_key/';
/** The API allows 1-5 days; the UI stops at 3 to keep world payloads reasonable. */
export const MAX_DAYS = 3;

export interface FirmsAreaUrlOptions {
  key: string;
  source: FirmsSource;
  area: BBox | 'world';
  days: number;
  /** YYYY-MM-DD; omitted means "most recent". */
  date?: string;
}

export function firmsAreaUrl(o: FirmsAreaUrlOptions): string {
  const area = o.area === 'world' ? 'world' : `${o.area.west},${o.area.south},${o.area.east},${o.area.north}`;
  const days = Math.min(5, Math.max(1, Math.floor(o.days) || 1));
  return `${FIRMS_API_BASE}/${o.key}/${o.source}/${area}/${days}${o.date ? `/${o.date}` : ''}`;
}

export function normaliseConfidence(raw: string, instrument: Instrument): Confidence {
  const v = raw.trim().toLowerCase();
  if (v === 'l' || v === 'low') return 'low';
  if (v === 'h' || v === 'high') return 'high';
  if (v === 'n' || v === 'nominal') return 'nominal';
  if (instrument === 'MODIS') {
    const n = Number(v);
    if (Number.isFinite(n)) return n < 30 ? 'low' : n < 80 ? 'nominal' : 'high';
  }
  return 'nominal';
}

/**
 * Parses a FIRMS CSV body (VIIRS or MODIS column set, looked up by header name). Malformed rows
 * are skipped; duplicate ids are dropped. Throws when the body is not a FIRMS CSV at all (for
 * example a plain-text error message). The thrown message never echoes the body.
 */
export function parseFirmsCsv(text: string): Hotspot[] {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const col = new Map<string, number>();
  header.forEach((h, i) => col.set(h, i));
  if (!col.has('latitude') || !col.has('longitude') || !col.has('acq_date') || !col.has('acq_time')) {
    throw new Error('Unexpected FIRMS response');
  }
  const headerInstrument: Instrument = col.has('bright_ti4') ? 'VIIRS' : 'MODIS';
  const iLat = col.get('latitude')!;
  const iLon = col.get('longitude')!;
  const iDate = col.get('acq_date')!;
  const iTime = col.get('acq_time')!;
  const iBright = col.get('bright_ti4') ?? col.get('brightness');
  const iFrp = col.get('frp');
  const iSat = col.get('satellite');
  const iInst = col.get('instrument');
  const iConf = col.get('confidence');
  const iDn = col.get('daynight');
  const iScan = col.get('scan');
  const iTrack = col.get('track');
  const pick = (f: string[], i: number | undefined): string => (i === undefined ? '' : (f[i] ?? ''));

  const out: Hotspot[] = [];
  const seen = new Set<string>();
  for (let k = 1; k < lines.length; k++) {
    const f = lines[k].split(',');
    if (f.length < header.length) continue;
    const lat = Number(f[iLat]);
    const lon = Number(f[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const acquiredAt = parseAcqTime(f[iDate], f[iTime]);
    if (acquiredAt === null) continue;
    const instRaw = pick(f, iInst).trim().toUpperCase();
    const instrument: Instrument = instRaw === 'VIIRS' || instRaw === 'MODIS' ? instRaw : headerInstrument;
    const satellite = pick(f, iSat).trim() || '?';
    const id = `${instrument[0]}${satellite}:${f[iDate].trim()}T${f[iTime].trim().padStart(4, '0')}:${lat.toFixed(4)},${lon.toFixed(4)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const dn = pick(f, iDn).trim().toUpperCase();
    out.push({
      id,
      lat,
      lon,
      frp: numberOr(pick(f, iFrp), 0),
      brightness: numberOr(pick(f, iBright), 0),
      confidence: normaliseConfidence(pick(f, iConf), instrument),
      satellite,
      instrument,
      acquiredAt,
      daynight: dn === 'N' ? 'N' : 'D',
      scan: numberOr(pick(f, iScan), 0),
      track: numberOr(pick(f, iTrack), 0),
    });
  }
  return out;
}

function numberOr(s: string, fallback: number): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

/** acq_date "YYYY-MM-DD" + acq_time "HHMM" (UTC, may lack leading zeros) -> epoch ms, or null. */
function parseAcqTime(date: string, time: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return null;
  const t = time.trim().padStart(4, '0');
  if (!/^\d{4}$/.test(t)) return null;
  const hh = Number(t.slice(0, 2));
  const mm = Number(t.slice(2, 4));
  if (hh > 23 || mm > 59) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ms = Date.UTC(Number(m[1]), month - 1, day, hh, mm);
  // Date.UTC rolls invalid days over (e.g. Feb 30); reject those too.
  if (!Number.isFinite(ms) || new Date(ms).getUTCMonth() !== month - 1) return null;
  return ms;
}

export interface HotspotFilters {
  hideLow: boolean;
  /** Minimum fire radiative power, MW. */
  minFrp: number;
  daynight: 'all' | 'day' | 'night';
}

export const DEFAULT_FILTERS: HotspotFilters = { hideLow: true, minFrp: 0, daynight: 'all' };

/** Returns the input array itself when every filter is neutral, so callers can skip work. */
export function filterHotspots(hs: Hotspot[], f: HotspotFilters): Hotspot[] {
  if (!f.hideLow && f.minFrp <= 0 && f.daynight === 'all') return hs;
  const dn = f.daynight === 'day' ? 'D' : f.daynight === 'night' ? 'N' : null;
  return hs.filter((h) => (!f.hideLow || h.confidence !== 'low') && h.frp >= f.minFrp && (dn === null || h.daynight === dn));
}

/** Linkage distance for fire regions, degrees (~2 km): detections closer than this join a region. */
export const REGION_LINK_DEG = 0.02;

/** A connected group of detections, outlined by the convex hull of their pixel footprints. */
export interface FireRegion {
  /** Stable while the strongest member stays: "R:" + that member's id. */
  id: string;
  /** Convex hull ring, [lon, lat] pairs, counter-clockwise, not closed. */
  hull: [number, number][];
  /** FRP-weighted centroid. */
  lat: number;
  lon: number;
  count: number;
  frpSum: number;
  frpMax: number;
  latestAt: number;
  /** Id of the member with the highest FRP. */
  sampleId: string;
  /** Hull area, km². */
  areaKm2: number;
  bbox: BBox;
}

const KM_PER_DEG = 111.32;
const DEFAULT_PIXEL_KM = 0.375;

/** Andrew's monotone chain. Returns the hull counter-clockwise without the closing point. */
export function convexHull(points: [number, number][]): [number, number][] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Shoelace area of a lon/lat ring, km², using a local equirectangular scale at the ring's mean latitude. */
function ringAreaKm2(ring: [number, number][]): number {
  if (ring.length < 3) return 0;
  const meanLat = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  const kx = KM_PER_DEG * Math.max(0.01, Math.cos((meanLat * Math.PI) / 180));
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * kx * y2 * KM_PER_DEG - x2 * kx * y1 * KM_PER_DEG;
  }
  return Math.abs(sum) / 2;
}

/**
 * Groups detections into fire regions: single-linkage on a `linkDeg` grid (8-neighbourhood), then
 * the convex hull of every member's pixel footprint (scan × track km, centred on the point).
 * Sorted by summed FRP, largest first.
 */
export function regionsFromHotspots(hs: Hotspot[], linkDeg = REGION_LINK_DEG): FireRegion[] {
  const n = hs.length;
  if (n === 0) return [];
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const cells = new Map<string, number>();
  const ci = new Int32Array(n);
  const cj = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    ci[i] = Math.floor(hs[i].lat / linkDeg);
    cj[i] = Math.floor(hs[i].lon / linkDeg);
    const key = `${ci[i]}:${cj[i]}`;
    const first = cells.get(key);
    if (first === undefined) cells.set(key, i);
    else union(first, i);
  }
  // Half the 8-neighbourhood is enough: the other half is visited from the neighbour's side.
  const offsets = [[0, 1], [1, -1], [1, 0], [1, 1]];
  for (const [key, first] of cells) {
    const [a, b] = key.split(':').map(Number);
    for (const [di, dj] of offsets) {
      const other = cells.get(`${a + di}:${b + dj}`);
      if (other !== undefined) union(first, other);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  }
  const out: FireRegion[] = [];
  for (const members of groups.values()) {
    const corners: [number, number][] = [];
    let count = 0, frpSum = 0, frpMax = -Infinity, latestAt = -Infinity, sampleId = '';
    let wLat = 0, wLon = 0, sLat = 0, sLon = 0;
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    for (const i of members) {
      const h = hs[i];
      const halfLat = ((h.track || DEFAULT_PIXEL_KM) / 2) / KM_PER_DEG;
      const halfLon = ((h.scan || DEFAULT_PIXEL_KM) / 2) / (KM_PER_DEG * Math.max(0.01, Math.cos((h.lat * Math.PI) / 180)));
      corners.push([h.lon - halfLon, h.lat - halfLat], [h.lon + halfLon, h.lat - halfLat], [h.lon + halfLon, h.lat + halfLat], [h.lon - halfLon, h.lat + halfLat]);
      const w = Math.max(0, h.frp);
      count++;
      frpSum += w;
      if (h.frp > frpMax) {
        frpMax = h.frp;
        sampleId = h.id;
      }
      if (h.acquiredAt > latestAt) latestAt = h.acquiredAt;
      wLat += h.lat * w;
      wLon += h.lon * w;
      sLat += h.lat;
      sLon += h.lon;
      west = Math.min(west, h.lon - halfLon);
      east = Math.max(east, h.lon + halfLon);
      south = Math.min(south, h.lat - halfLat);
      north = Math.max(north, h.lat + halfLat);
    }
    const hull = convexHull(corners);
    out.push({
      id: `R:${sampleId}`,
      hull,
      lat: frpSum > 0 ? wLat / frpSum : sLat / count,
      lon: frpSum > 0 ? wLon / frpSum : sLon / count,
      count,
      frpSum,
      frpMax,
      latestAt,
      sampleId,
      areaKm2: ringAreaKm2(hull),
      bbox: { west, south, east, north },
    });
  }
  out.sort((x, y) => y.frpSum - x.frpSum || y.count - x.count);
  return out;
}

export function ageHours(h: Hotspot, nowMs: number): number {
  return Math.max(0, (nowMs - h.acquiredAt) / 3_600_000);
}
