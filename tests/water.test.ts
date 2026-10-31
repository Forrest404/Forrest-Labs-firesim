import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/contract';
import type { Intervention } from '../src/contract';
import { buildEventLayers, moistureAt, timeUntilMoisture } from '../src/sim/events';

const spray = (id: string, t: number, boost: number): Intervention => ({ id, tSeconds: t, type: 'water', cells: [7], params: { moistureBoost: boost, halfLifeS: 600 } });

describe('water sprays', () => {
  it('a later spray does not erase an earlier one before it happens', () => {
    const once = buildEventLayers([spray('a', 0, 0.4)], 10, DEFAULT_SETTINGS);
    const twice = buildEventLayers([spray('a', 0, 0.4), spray('b', 5000, 0.1)], 10, DEFAULT_SETTINGS);
    expect(moistureAt(twice, 7, 300, 0.05)).toBeCloseTo(moistureAt(once, 7, 300, 0.05), 10);
    expect(moistureAt(twice, 7, 5000, 0.05)).toBeCloseTo(0.15, 10);
  });

  it('dry time waits for a spray that starts while the cell is still drying', () => {
    const layers = buildEventLayers([spray('a', 0, 0.4), spray('b', 500, 0.4)], 10, DEFAULT_SETTINGS);
    const t = timeUntilMoisture(layers, 7, 0.05, 0.15, 0);
    expect(t).toBeCloseTo(500 + 600 * Math.log2(0.4 / 0.1), 6);
    expect(moistureAt(layers, 7, t, 0.05)).toBeCloseTo(0.15, 6);
  });
});
