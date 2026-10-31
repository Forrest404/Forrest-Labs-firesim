import { describe, expect, it } from 'vitest';
import {
  closestPerimeterEntry,
  computeEngineTransit,
  discoverFireStations,
  findBestDipSite,
  getFallbackStationSeeds,
  haversineKm,
} from '../src/agent/logistics';
import { makeSyntheticArea } from '../src/data/synthetic';

describe('Agent 1 — Logistics, OSRM Routing & Dip-Site Finder', () => {
  const area = makeSyntheticArea({
    name: 'boulder-creek',
    label: 'Boulder Creek, CA (synthetic)',
    centerLon: -122.122,
    centerLat: 37.126,
    seed: 101,
    style: 'ridge',
  });

  it('computes accurate Haversine distance in km', () => {
    const d = haversineKm(-122.122, 37.126, -122.122, 37.226);
    expect(d).toBeGreaterThan(10.5);
    expect(d).toBeLessThan(11.6);
  });

  it('clamps external station coordinates onto the grid perimeter', () => {
    const entry = closestPerimeterEntry(area.grid, area.grid.bounds.west - 0.1, area.grid.bounds.north + 0.1);
    expect(entry.cell.row).toBe(0);
    expect(entry.cell.col).toBe(0);
  });

  it('provides balanced fallback stations (engines, helicopter, airtanker)', () => {
    const seeds = getFallbackStationSeeds('boulder-creek', area.grid);
    expect(seeds.length).toBeGreaterThanOrEqual(4);
    expect(seeds.some((s) => s.unitType === 'engine')).toBe(true);
    expect(seeds.some((s) => s.unitType === 'helicopter')).toBe(true);
    expect(seeds.some((s) => s.unitType === 'airtanker')).toBe(true);
  });

  it('calculates engine transit time using tortuosity fallback when network is disabled', async () => {
    const res = await computeEngineTransit(-122.15, 37.10, -122.122, 37.126, 55, 90, false);
    expect(res.routingMethod).toBe('tortuosity');
    expect(res.routeDistanceKm).toBeGreaterThan(3.0);
    expect(res.travelTimeSeconds).toBeGreaterThan(200);
  });

  it('discovers and hydrates sorted fire station assets offline calibrated to average fire truck speed (55 km/h) and water drop (2,500 L)', async () => {
    const stations = await discoverFireStations(area, { enableNetwork: false });
    expect(stations.length).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < stations.length; i++) {
      expect(stations[i].speedKmh).toBe(55);
      expect(stations[i].waterCapacityLiters).toBe(2500);
      expect(stations[i].waterRadiusCells).toBe(2);
      expect(stations[i].dropLengthCells).toBe(12);
      if (i > 0) {
        expect(stations[i].travelTimeSeconds).toBeGreaterThanOrEqual(stations[i - 1].travelTimeSeconds);
      }
    }
  });

  it('locates a valid on-grid river/water dip site for helicopter Wave 2 refills', () => {
    const dipSite = findBestDipSite(area, { row: 100, col: 100 });
    expect(dipSite).not.toBeNull();
    expect(dipSite!.turnaroundSeconds).toBeGreaterThanOrEqual(180);
    expect(dipSite!.turnaroundSeconds).toBeLessThanOrEqual(480);
  });
});
