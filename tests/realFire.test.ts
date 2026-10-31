import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FuelClass, NEVER_ARRIVES } from '../src/contract';
import { fbfm40ToFuelClass } from '../src/data/landfire';
import { makeGridSpec } from '../src/data/geo';
import { revealOrder } from '../src/ui/realVsSim';
import { controlRuns } from '../src/app/realFire';
import { decodeBundle, scenarioFromArea } from '../src/data/bundle';
import type { DemoAreaBundle } from '../src/data/bundle';
import { COMPARE_RGBA, paintCompare } from '../src/viewer/burnCanvas';

const I = NEVER_ARRIVES;

describe('accuracy colours', () => {
  it('paints both green, real-only red, sim-only amber, neither transparent', () => {
    const arrival = Float32Array.from([10, 10, I, I, 500]);
    const mask = Uint8Array.from([1, 0, 1, 0, 1]);
    const data = new Uint8ClampedArray(arrival.length * 4);
    paintCompare(data, arrival, 100, mask);
    const px = (i: number): number[] => Array.from(data.slice(i * 4, i * 4 + 4));
    expect(px(0)).toEqual(COMPARE_RGBA.both);
    expect(px(1)).toEqual(COMPARE_RGBA.extra);
    expect(px(2)).toEqual(COMPARE_RGBA.missed);
    expect(px(3)).toEqual([0, 0, 0, 0]);
    // Arrives after t: not burned yet, so the real cell counts as missed.
    expect(px(4)).toEqual(COMPARE_RGBA.missed);
  });
});

describe('real-fire control runs (Crozier)', () => {
  const crozier = decodeBundle(JSON.parse(readFileSync('public/demo-areas/crozier.json', 'utf8')) as DemoAreaBundle);
  const runs = controlRuns(scenarioFromArea(crozier), crozier.reference!);

  it('runs the real wind, no wind and the wind reversed', () => {
    expect(runs.map((r) => r.kind)).toEqual(['real', 'noWind', 'reversed']);
    expect(runs[0].overlap).not.toBeNull();
  });

  it('matches the real fire best with the real wind', () => {
    const iou = runs.map((r) => r.overlap?.iou ?? 0);
    expect(iou[0]).toBeGreaterThan(iou[1]);
    expect(iou[0]).toBeGreaterThan(iou[2]);
  });
});

describe('LANDFIRE fuel', () => {
  it('maps fuel model families to the app classes', () => {
    expect(fbfm40ToFuelClass(102)).toBe(FuelClass.GRASS);
    expect(fbfm40ToFuelClass(122)).toBe(FuelClass.SHRUB);
    expect(fbfm40ToFuelClass(145)).toBe(FuelClass.SHRUB);
    expect(fbfm40ToFuelClass(165)).toBe(FuelClass.FOREST_CONIFER);
    expect(fbfm40ToFuelClass(183)).toBe(FuelClass.FOREST_CONIFER);
    expect(fbfm40ToFuelClass(189)).toBe(FuelClass.FOREST_DECIDUOUS);
    for (const nb of [0, 91, 93, 98, 99]) expect(fbfm40ToFuelClass(nb)).toBe(FuelClass.NONE);
  });

  it('Crozier uses real fuel with Rothermel and still matches best with the real wind', () => {
    const crozier = decodeBundle(JSON.parse(readFileSync('public/demo-areas/crozier.json', 'utf8')) as DemoAreaBundle);
    expect(crozier.meta.defaultSettings?.rateModel).toBe('rothermel');
    const kinds = new Set(crozier.fuel);
    expect(kinds.size).toBeGreaterThan(2);
    const runs = controlRuns(scenarioFromArea(crozier), crozier.reference!);
    expect(runs[0].overlap!.iou).toBeGreaterThan(0.6);
  });
});

describe('real fire reveal order', () => {
  it('grows outward from the start through the burned area only', () => {
    const grid = makeGridSpec({ centerLon: 0, centerLat: 0, width: 5, height: 1, cellSizeM: 30 });
    const mask = Uint8Array.from([1, 1, 1, 0, 1]);
    const rank = revealOrder(mask, grid, { row: 0, col: 1 });
    expect(rank[1]).toBe(0);
    expect(Math.max(rank[0], rank[2])).toBe(2);
    expect(rank[3]).toBe(-1);
    // The detached piece (a spot fire) comes last.
    expect(rank[4]).toBe(3);
  });
});
