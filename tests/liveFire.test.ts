import { describe, expect, it } from 'vitest';
import { FuelClass, NEVER_ARRIVES } from '../src/contract';
import { fetchLiveFires, nearestBurnable } from '../src/data/liveFire';
import { FORECAST_RINGS, forecastRingCells } from '../src/viewer/burnCanvas';

const I = NEVER_ARRIVES;

describe('live fires', () => {
  it('parses NIFC incidents and skips ones without a location', async () => {
    const body = { features: [
      { attributes: { UniqueFireIdentifier: 'a', IncidentName: 'ADOBE', IncidentSize: 12, PercentContained: 40, FireDiscoveryDateTime: 1000 }, geometry: { x: -117.7, y: 34.5 } },
      { attributes: { UniqueFireIdentifier: 'b', IncidentName: 'NOWHERE' } },
    ] };
    const fires = await fetchLiveFires('US-CA', 8, (async () => new Response(JSON.stringify(body))) as typeof fetch);
    expect(fires).toHaveLength(1);
    expect(fires[0]).toMatchObject({ name: 'ADOBE', lat: 34.5, lon: -117.7, acres: 12, containedPct: 40 });
  });

  it('starts from real wildland, not a lone patch of grass in town', () => {
    const W = 20;
    const fuel = new Uint8Array(W * W); // town everywhere...
    fuel[5 * W + 5] = FuelClass.GRASS; // ...a lone lawn next to the reported point
    for (let r = 0; r < W; r++) for (let c = 12; c < W; c++) fuel[r * W + c] = FuelClass.SHRUB; // hills to the east
    const start = nearestBurnable(fuel, W, W, { row: 5, col: 4 });
    expect(start!.col).toBeGreaterThanOrEqual(12);
  });
});

describe('forecast rings', () => {
  it('outlines only the advancing edge, not roads inside the fire or the grid border', () => {
    // 5 x 1 strip: burned by 1 h at cells 0-2, a road at 1, unburned fuel at 3-4.
    const arrival = Float32Array.from([0, I, 1800, 7200, I]);
    const fuel = Uint8Array.from([FuelClass.GRASS, FuelClass.NONE, FuelClass.GRASS, FuelClass.GRASS, FuelClass.GRASS]);
    const cells = forecastRingCells(arrival, fuel, 5, FORECAST_RINGS);
    expect(Array.from(cells)).toEqual([0, 0, 1, 3, 0]);
  });
});
