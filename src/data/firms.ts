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

export interface HotspotCluster {
  /** Bin key "latIndex:lonIndex". */
  id: string;
  /** FRP-weighted centroid. */
  lat: number;
  lon: number;
  count: number;
  frpSum: number;
  frpMax: number;
  latestAt: number;
  /** Id of the member with the highest FRP. */
  sampleId: string;
}

/** Bin size used by the UI's "largest fires" list, degrees. */
export const CLUSTER_CELL_DEG = 0.25;

export function clusterKey(lat: number, lon: number, cellDeg = CLUSTER_CELL_DEG): string {
  return `${Math.floor(lat / cellDeg)}:${Math.floor(lon / cellDeg)}`;
}

/** Bins detections on a cellDeg grid and returns the top `limit` bins by summed FRP. */
export function clusterHotspots(hs: Hotspot[], cellDeg = CLUSTER_CELL_DEG, limit = 10): HotspotCluster[] {
  interface Acc { c: HotspotCluster; wLat: number; wLon: number; sLat: number; sLon: number }
  const bins = new Map<string, Acc>();
  for (const h of hs) {
    const id = clusterKey(h.lat, h.lon, cellDeg);
    let a = bins.get(id);
    if (!a) {
      a = { c: { id, lat: 0, lon: 0, count: 0, frpSum: 0, frpMax: -Infinity, latestAt: -Infinity, sampleId: h.id }, wLat: 0, wLon: 0, sLat: 0, sLon: 0 };
      bins.set(id, a);
    }
    const w = Math.max(0, h.frp);
    a.c.count++;
    a.c.frpSum += w;
    if (h.frp > a.c.frpMax) {
      a.c.frpMax = h.frp;
      a.c.sampleId = h.id;
    }
    if (h.acquiredAt > a.c.latestAt) a.c.latestAt = h.acquiredAt;
    a.wLat += h.lat * w;
    a.wLon += h.lon * w;
    a.sLat += h.lat;
    a.sLon += h.lon;
  }
  const out: HotspotCluster[] = [];
  for (const a of bins.values()) {
    if (a.c.frpSum > 0) {
      a.c.lat = a.wLat / a.c.frpSum;
      a.c.lon = a.wLon / a.c.frpSum;
    } else {
      a.c.lat = a.sLat / a.c.count;
      a.c.lon = a.sLon / a.c.count;
    }
    out.push(a.c);
  }
  out.sort((x, y) => y.frpSum - x.frpSum || y.count - x.count);
  return out.slice(0, Math.max(0, limit));
}

export function ageHours(h: Hotspot, nowMs: number): number {
  return Math.max(0, (nowMs - h.acquiredAt) / 3_600_000);
}
