/**
 * The crossing integrators must agree with a brute-force fine-step integral of the same rate
 * function. (A spray that started inside a grid interval used to be missed entirely: up to a 4000 %
 * error in the crossing time, found by comparing the two integrators against each other.)
 */
import { describe, expect, it } from 'vitest';
import { FUELS, FuelClass } from '../src/contract';
import type { Scenario } from '../src/contract';
import { crossTimeVarying, crossWetEdge } from '../src/sim/crossing';
import { buildEventLayers, sprayContribution } from '../src/sim/events';
import { createRateFn } from '../src/sim/models';
import { mulberry32 } from '../src/sim/prng';
import { createWeatherTimeline } from '../src/sim/weather';
import { makeFixture } from './fixtures';

interface Case {
  s: Scenario;
  layers: ReturnType<typeof buildEventLayers>;
  fuel: number;
  base: number;
  mx: number;
  t0: number;
  dist: number;
  cos: number;
  dz: number;
}

function randomCase(rand: () => number): Case {
  const fuel = 1 + Math.floor(rand() * 5);
  const base = 0.03 + rand() * 0.15;
  const s = makeFixture({ weather: { windSpeedMps: rand() * 12, windFromDeg: 270, baseFuelMoisture: base }, settings: { rateModel: rand() < 0.5 ? 'factors' : 'rothermel' } });
  s.weatherSchedule = [{ tSeconds: 100, windSpeedMps: s.weather.windSpeedMps }]; // constant weather, so only the spray varies
  const sprays = Array.from({ length: 1 + Math.floor(rand() * 2) }, (_, k) => ({
    id: `w${k}`, tSeconds: rand() * 3000, type: 'water' as const, cells: [1], params: { moistureBoost: 0.05 + rand() * 0.6, halfLifeS: 100 + rand() * 4000 },
  }));
  return {
    s, layers: buildEventLayers(sprays, 5, s.settings), fuel, base, mx: FUELS[fuel as FuelClass].extinctionMoisture,
    t0: rand() * 4000, dist: rand() < 0.5 ? 30 : 42.4, cos: rand() * 2 - 1, dz: (rand() - 0.5) * 30,
  };
}

function bruteForce(c: Case, rateFn: ReturnType<typeof createRateFn>): number {
  const e = { fuel: c.fuel, moisture: c.base, cosTheta: c.cos, windSpeedMps: c.s.weather.windSpeedMps, dz: c.dz, dist: c.dist };
  let tau = c.t0;
  let rem = c.dist;
  const dt = 0.5;
  while (rem > 0 && tau < 2e5) {
    const m = c.base + sprayContribution(c.layers, 1, tau + dt / 2);
    if (m < c.mx) {
      e.moisture = m;
      rem -= rateFn(e) * dt;
    }
    tau += dt;
  }
  return tau;
}

describe('crossing integrators vs brute-force integration (burnout off)', () => {
  const rand = mulberry32(2024);
  const cases = Array.from({ length: 400 }, () => randomCase(rand));

  for (const [name, run] of [
    ['crossWetEdge (steady weather)', (c: Case, rateFn: ReturnType<typeof createRateFn>) => {
      const out = { t: 0, rate: 0 };
      crossWetEdge(c.layers, 1, c.t0, c.dist, c.base, c.mx, Infinity, 1e9, rateFn, { fuel: c.fuel, moisture: c.base, cosTheta: c.cos, windSpeedMps: c.s.weather.windSpeedMps, dz: c.dz, dist: c.dist }, out);
      return out.t;
    }],
    ['crossTimeVarying (weather schedule)', (c: Case, rateFn: ReturnType<typeof createRateFn>) => {
      const out = { t: 0, rate: 0 };
      const tl = createWeatherTimeline(c.s)!;
      crossTimeVarying({ layers: c.layers, timeline: tl, rateFn, edge: { fuel: c.fuel, moisture: c.base, cosTheta: 0, windSpeedMps: 0, dz: c.dz, dist: c.dist }, duration: 1e9 }, 1, c.t0, c.dist, c.cos, Math.sqrt(1 - c.cos * c.cos), 0, c.mx, Infinity, out);
      return out.t;
    }],
  ] as const) {
    it(`${name}: within 5 % of the brute-force crossing time on 400 random edges (median within 1 %)`, () => {
      const errs: number[] = [];
      for (const c of cases) {
        const rateFn = createRateFn(c.s);
        const t = run(c, rateFn);
        const truth = bruteForce(c, rateFn);
        if (!Number.isFinite(t) || truth >= 2e5) continue;
        errs.push(Math.abs(t - truth) / Math.max(1, truth - c.t0));
      }
      expect(errs.length).toBeGreaterThan(300);
      errs.sort((a, b) => a - b);
      console.log(`${name}: ${errs.length} cases, median error ${(errs[errs.length >> 1] * 100).toFixed(2)} %, worst ${(errs[errs.length - 1] * 100).toFixed(2)} %`);
      expect(errs[errs.length >> 1]).toBeLessThan(0.01);
      expect(errs[errs.length - 1]).toBeLessThan(0.05);
    });
  }

  it('a spray that starts just before the front would finish is not missed (the original failure)', () => {
    const base = 0.074;
    const s = makeFixture({ weather: { windSpeedMps: 5, windFromDeg: 270, baseFuelMoisture: base }, settings: { rateModel: 'factors' } });
    const layers = buildEventLayers([{ id: 'w', tSeconds: 692, type: 'water', cells: [1], params: { moistureBoost: 0.17, halfLifeS: 2691 } }], 5, s.settings);
    const rateFn = createRateFn(s);
    const out = { t: 0, rate: 0 };
    crossWetEdge(layers, 1, 380, 30, base, 0.3, Infinity, 1e9, rateFn, { fuel: FuelClass.FARMLAND, moisture: base, cosTheta: 0.82, windSpeedMps: 5, dz: 1.3, dist: 30 }, out);
    expect(out.t).toBeGreaterThan(1000); // unsprayed it would be done by ~720 s
    expect(out.t).toBeLessThan(1100);
  });
});
