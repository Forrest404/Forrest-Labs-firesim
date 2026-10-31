import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NEVER_ARRIVES } from '../src/contract';
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
