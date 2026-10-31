import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  MAX_DAYS,
  SOURCE_SETS,
  ageHours,
  clusterHotspots,
  filterHotspots,
  firmsAreaUrl,
  normaliseConfidence,
  parseFirmsCsv,
} from '../src/data/firms';

const KEY = 'ffffffffffffffffffffffffffffffff';

const VIIRS = `latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
-15.8213,131.1125,345.2,0.39,0.36,2026-10-31,0412,N20,VIIRS,n,2.0NRT,298.1,12.6,N
36.5012,-118.9031,367.0,0.52,0.42,2026-10-31,2055,N,VIIRS,h,2.0NRT,301.4,88.3,D
-3.1102,-52.4471,330.1,0.41,0.37,2026-10-30,1650,N20,VIIRS,l,2.0NRT,295.0,3.2,D`;

const MODIS = `latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight
-15.831,131.102,321.5,1.1,1.0,2026-10-31,0430,Aqua,MODIS,85,6.1NRT,295.2,27.4,N
40.112,-105.2,305.0,1.0,1.0,2026-10-31,1810,Terra,MODIS,42,6.1NRT,290.8,9.9,D
40.2,-105.3,305.0,1.0,1.0,2026-10-31,1810,Terra,MODIS,12,6.1NRT,290.8,1.0,D`;

describe('parseFirmsCsv', () => {
  it('parses the VIIRS column set', () => {
    const hs = parseFirmsCsv(VIIRS);
    expect(hs).toHaveLength(3);
    const [a, b, c] = hs;
    expect(a.lat).toBe(-15.8213);
    expect(a.lon).toBe(131.1125);
    expect(a.brightness).toBe(345.2);
    expect(a.frp).toBe(12.6);
    expect(a.instrument).toBe('VIIRS');
    expect(a.satellite).toBe('N20');
    expect(a.daynight).toBe('N');
    expect(a.scan).toBe(0.39);
    expect(a.track).toBe(0.36);
    expect(a.acquiredAt).toBe(Date.UTC(2026, 9, 31, 4, 12));
    expect([a.confidence, b.confidence, c.confidence]).toEqual(['nominal', 'high', 'low']);
    expect(b.daynight).toBe('D');
  });

  it('parses the MODIS column set and maps numeric confidence', () => {
    const hs = parseFirmsCsv(MODIS);
    expect(hs).toHaveLength(3);
    expect(hs[0].brightness).toBe(321.5);
    expect(hs[0].instrument).toBe('MODIS');
    expect(hs[0].satellite).toBe('Aqua');
    expect(hs.map((h) => h.confidence)).toEqual(['high', 'nominal', 'low']);
  });

  it('infers the instrument from the header when the column is missing (keyless CSV files)', () => {
    const noInst = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight\n30.28427,-81.97945,299.88,0.42,0.61,2026-10-30,0642,N,nominal,2.0NRT,287.84,0.59,N';
    const [h] = parseFirmsCsv(noInst);
    expect(h.instrument).toBe('VIIRS');
    expect(h.confidence).toBe('nominal');
    expect(h.acquiredAt).toBe(Date.UTC(2026, 9, 30, 6, 42));
  });

  it('tolerates CRLF line endings and a trailing newline', () => {
    const crlf = VIIRS.replace(/\n/g, '\r\n') + '\r\n';
    expect(parseFirmsCsv(crlf)).toHaveLength(3);
    expect(parseFirmsCsv(crlf)[0].daynight).toBe('N');
  });

  it('returns [] for an empty body or a header-only body', () => {
    expect(parseFirmsCsv('')).toEqual([]);
    expect(parseFirmsCsv(VIIRS.split('\n')[0] + '\n')).toEqual([]);
  });

  it('skips malformed rows and keeps the rest', () => {
    const broken = VIIRS + '\nabc,131.1,345.2,0.39,0.36,2026-10-31,0412,N20,VIIRS,n,2.0NRT,298.1,12.6,N\n1,2,3\n-15.9,131.2,345.2,0.39,0.36,2026-13-31,0412,N20,VIIRS,n,2.0NRT,298.1,12.6,N\n-15.9,131.2,345.2,0.39,0.36,2026-02-30,0412,N20,VIIRS,n,2.0NRT,298.1,12.6,N\n-15.9,131.2,345.2,0.39,0.36,2026-10-31,2460,N20,VIIRS,n,2.0NRT,298.1,12.6,N';
    expect(parseFirmsCsv(broken)).toHaveLength(3);
  });

  it('pads short acq_time values', () => {
    const short = VIIRS.split('\n').slice(0, 2).join('\n').replace(',0412,', ',412,');
    expect(parseFirmsCsv(short)[0].acquiredAt).toBe(Date.UTC(2026, 9, 31, 4, 12));
  });

  it('throws on a plain-text body without echoing it', () => {
    expect(() => parseFirmsCsv('Invalid MAP_KEY.')).toThrow(/Unexpected FIRMS response/);
    expect(() => parseFirmsCsv('Invalid MAP_KEY.')).not.toThrow(/MAP_KEY/);
  });

  it('gives deterministic, unique ids and drops exact duplicates', () => {
    const a = parseFirmsCsv(VIIRS).map((h) => h.id);
    const b = parseFirmsCsv(VIIRS).map((h) => h.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(3);
    const dup = VIIRS + '\n' + VIIRS.split('\n')[1];
    expect(parseFirmsCsv(dup)).toHaveLength(3);
  });
});

describe('firmsAreaUrl', () => {
  it('builds world and bbox urls in west,south,east,north order', () => {
    expect(firmsAreaUrl({ key: KEY, source: 'VIIRS_SNPP_NRT', area: 'world', days: 1 }))
      .toBe(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${KEY}/VIIRS_SNPP_NRT/world/1`);
    expect(firmsAreaUrl({ key: KEY, source: 'MODIS_NRT', area: { west: -125, south: 32, east: -114, north: 42 }, days: 2 }))
      .toBe(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${KEY}/MODIS_NRT/-125,32,-114,42/2`);
  });

  it('appends a start date and clamps the day range to 1..5', () => {
    expect(firmsAreaUrl({ key: KEY, source: 'VIIRS_NOAA20_NRT', area: 'world', days: 3, date: '2020-08-17' })).toMatch(/\/world\/3\/2020-08-17$/);
    expect(firmsAreaUrl({ key: KEY, source: 'VIIRS_NOAA20_NRT', area: 'world', days: 0 })).toMatch(/\/world\/1$/);
    expect(firmsAreaUrl({ key: KEY, source: 'VIIRS_NOAA20_NRT', area: 'world', days: 9 })).toMatch(/\/world\/5$/);
    expect(firmsAreaUrl({ key: KEY, source: 'VIIRS_NOAA20_NRT', area: 'world', days: 2.9 })).toMatch(/\/world\/2$/);
  });

  it('keeps the UI cap below the API cap', () => {
    expect(MAX_DAYS).toBeLessThanOrEqual(5);
    expect(SOURCE_SETS.viirs).toEqual(['VIIRS_NOAA20_NRT', 'VIIRS_SNPP_NRT']);
  });
});

describe('normaliseConfidence', () => {
  it('accepts letters, words and MODIS percentages', () => {
    expect(normaliseConfidence('l', 'VIIRS')).toBe('low');
    expect(normaliseConfidence('High', 'VIIRS')).toBe('high');
    expect(normaliseConfidence('nominal', 'VIIRS')).toBe('nominal');
    expect(normaliseConfidence('29', 'MODIS')).toBe('low');
    expect(normaliseConfidence('30', 'MODIS')).toBe('nominal');
    expect(normaliseConfidence('79', 'MODIS')).toBe('nominal');
    expect(normaliseConfidence('80', 'MODIS')).toBe('high');
    expect(normaliseConfidence('??', 'VIIRS')).toBe('nominal');
  });
});

describe('filterHotspots', () => {
  const all = [...parseFirmsCsv(VIIRS), ...parseFirmsCsv(MODIS)];

  it('returns the same array reference when every filter is neutral', () => {
    const out = filterHotspots(all, { hideLow: false, minFrp: 0, daynight: 'all' });
    expect(out).toBe(all);
  });

  it('hides low confidence by default', () => {
    expect(DEFAULT_FILTERS.hideLow).toBe(true);
    const out = filterHotspots(all, DEFAULT_FILTERS);
    expect(out).toHaveLength(4);
    expect(out.every((h) => h.confidence !== 'low')).toBe(true);
  });

  it('applies the FRP floor and the day/night pass', () => {
    expect(filterHotspots(all, { hideLow: false, minFrp: 20, daynight: 'all' }).map((h) => h.frp)).toEqual([88.3, 27.4]);
    expect(filterHotspots(all, { hideLow: false, minFrp: 0, daynight: 'night' })).toHaveLength(2);
    expect(filterHotspots(all, { hideLow: false, minFrp: 0, daynight: 'day' })).toHaveLength(4);
  });
});

describe('clusterHotspots', () => {
  const all = [...parseFirmsCsv(VIIRS), ...parseFirmsCsv(MODIS)];

  it('bins nearby detections and sums their FRP', () => {
    const clusters = clusterHotspots(all, 0.25);
    expect(clusters[0].id).toBe('146:-476'); // the 88.3 MW Sierra point is the largest single bin
    expect(clusters[0].count).toBe(1);
    const aus = clusters.find((c) => c.count === 2)!;
    expect(aus).toBeDefined();
    expect(aus.frpSum).toBeCloseTo(40, 9);
    expect(aus.frpMax).toBe(27.4);
    expect(aus.latestAt).toBe(Date.UTC(2026, 9, 31, 4, 30));
    expect(aus.sampleId).toMatch(/^MAqua:/);
    // FRP-weighted centroid sits between the two points, nearer the 27.4 MW one.
    expect(aus.lat).toBeGreaterThan(-15.831);
    expect(aus.lat).toBeLessThan(-15.8213);
    expect(Math.abs(aus.lat - -15.831)).toBeLessThan(Math.abs(aus.lat - -15.8213));
  });

  it('sorts by summed FRP and honours the limit', () => {
    const sums = clusterHotspots(all, 0.25).map((c) => c.frpSum);
    expect(sums).toEqual([...sums].sort((a, b) => b - a));
    expect(clusterHotspots(all, 0.25, 2)).toHaveLength(2);
    expect(clusterHotspots([], 0.25)).toEqual([]);
  });

  it('falls back to a plain centroid when FRP is zero', () => {
    const zero = parseFirmsCsv(VIIRS).slice(0, 1).map((h) => ({ ...h, frp: 0 }));
    const [c] = clusterHotspots(zero);
    expect(c.lat).toBe(zero[0].lat);
    expect(c.lon).toBe(zero[0].lon);
  });
});

describe('ageHours', () => {
  it('is hours since acquisition, never negative', () => {
    const [h] = parseFirmsCsv(VIIRS);
    expect(ageHours(h, h.acquiredAt + 2.5 * 3_600_000)).toBeCloseTo(2.5, 9);
    expect(ageHours(h, h.acquiredAt - 3_600_000)).toBe(0);
  });
});
