import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, DEFAULT_WEATHER, FUELS, FuelClass, applyDrynessPreset, validateScenario } from '../src/contract';
import { createRateFn } from '../src/sim/models';
import type { EdgeInput } from '../src/sim/models';
import { simulate } from '../src/sim';
import { MS_TO_FTMIN, prepareBed, reaction, spreadRate, windLimit } from '../src/sim/rothermel';
import { makeFixture } from './fixtures';

const BURNABLE = [FuelClass.GRASS, FuelClass.SHRUB, FuelClass.FOREST_DECIDUOUS, FuelClass.FOREST_CONIFER, FuelClass.FARMLAND];
const bed = (f: FuelClass) => prepareBed(FUELS[f].bed, FUELS[f].extinctionMoisture);

describe('rothermel equations', () => {
  it('every burnable fuel has a valid bed; the non-burnable class does not', () => {
    for (const f of BURNABLE) expect(bed(f).valid, FUELS[f].name).toBe(true);
    expect(bed(FuelClass.NONE).valid).toBe(false);
    expect(reaction(bed(FuelClass.NONE), 0.05)).toEqual({ r0: 0, ir: 0 });
  });

  it('no-wind spread is positive when dry, strictly decreasing in moisture, and exactly zero at extinction', () => {
    for (const f of BURNABLE) {
      const p = bed(f);
      let prev = Infinity;
      for (let m = 0; m < p.mx; m += 0.01) {
        const r = reaction(p, m).r0;
        expect(r, `${FUELS[f].name} m=${m}`).toBeGreaterThan(0);
        expect(r).toBeLessThan(prev);
        expect(Number.isFinite(r)).toBe(true);
        prev = r;
      }
      expect(reaction(p, p.mx).r0).toBe(0);
      expect(reaction(p, p.mx + 0.2).r0).toBe(0);
    }
  });

  it('no-wind spread rates are in a physically plausible range (0.05 - 5 m/min)', () => {
    for (const f of BURNABLE) {
      const rMin = reaction(bed(f), 0.08).r0 * 0.3048; // ft/min -> m/min
      expect(rMin, FUELS[f].name).toBeGreaterThan(0.05);
      expect(rMin, FUELS[f].name).toBeLessThan(5);
    }
  });

  it('wind and slope increase spread; the wind limit caps the effect', () => {
    for (const f of BURNABLE) {
      const p = bed(f);
      const r = reaction(p, 0.08);
      const base = spreadRate(p, r, 0, 0);
      expect(base).toBeCloseTo(r.r0 * 0.00508, 12);
      let prev = base;
      for (const u of [50, 100, 200, 400, 800]) {
        const v = spreadRate(p, r, u, 0);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
      let prevS = base;
      for (const deg of [5, 10, 20, 30, 45]) {
        const v = spreadRate(p, r, 0, Math.tan((deg * Math.PI) / 180));
        expect(v).toBeGreaterThan(prevS);
        prevS = v;
      }
      const lim = windLimit(r.ir);
      expect(spreadRate(p, r, lim * 5, 0)).toBeCloseTo(spreadRate(p, r, lim, 0), 10);
      expect(spreadRate(p, r, -300, -1)).toBeCloseTo(base, 12); // opposing wind / downhill give no change
    }
  });

  it('is bounded: even bone-dry grass in a gale on a 45 degree slope stays below 12 m/s', () => {
    const p = bed(FuelClass.GRASS);
    const r = reaction(p, 0);
    expect(spreadRate(p, r, 40 * MS_TO_FTMIN, 1)).toBeLessThan(12);
  });

  it('the limit applies to the COMBINED wind and slope effect', () => {
    for (const f of BURNABLE) {
      const p = bed(f);
      const r = reaction(p, 0.06);
      const gale = 200 * MS_TO_FTMIN;
      const windOnly = spreadRate(p, r, gale, 0);
      // Already at the limit with wind alone: adding any slope cannot raise it further.
      expect(spreadRate(p, r, gale, 0.5)).toBeCloseTo(windOnly, 10);
      expect(spreadRate(p, r, gale, 2)).toBeCloseTo(windOnly, 10);
      // Below the limit, slope still adds.
      const calm = 0.5 * MS_TO_FTMIN;
      expect(spreadRate(p, r, calm, 0.3)).toBeGreaterThan(spreadRate(p, r, calm, 0));
    }
  });

  it('light fuels spread faster than heavy litter under the same wind (grass > deciduous litter)', () => {
    const g = bed(FuelClass.GRASS);
    const d = bed(FuelClass.FOREST_DECIDUOUS);
    const u = 3 * 0.3 * MS_TO_FTMIN;
    expect(spreadRate(g, reaction(g, 0.08), u, 0)).toBeGreaterThan(spreadRate(d, reaction(d, 0.08), u, 0) * 3);
  });
});

describe('rothermel pinned values (independent calculation)', () => {
  // Reference numbers were computed separately in Python from the published equations
  // (Rothermel 1972 with Albini 1976 revisions) for the grass bed in src/contract/fuels.ts.
  // They pin every transcribed constant: a typo anywhere changes at least one of them.
  const rel = (actual: number, expected: number, tol = 1e-6): void => expect(Math.abs(actual / expected - 1)).toBeLessThan(tol);
  const g = bed(FuelClass.GRASS);

  it('bed coefficients', () => {
    rel(g.ratio, 0.2535078578649842);
    rel(g.gammaPrime, 14.202444739128946);
    rel(g.xi, 0.057845754660160356);
    rel(g.eps, 0.9613388166363296);
    rel(g.mineralDamping, 0.4173969279093913);
    rel(g.windC, 5.424601628439073e-5);
    rel(g.windB, 2.071244248952671);
    rel(g.windE, 0.2035223806179849);
    rel(g.slopeCoef, 41.13970332182303);
  });

  it('reaction intensity and no-wind rate of spread across the moisture range', () => {
    for (const [m, ir, r0] of [[0, 1522.917, 10.78808], [0.08, 922.829, 4.81694], [0.2, 763.715, 2.85821], [0.29, 139.715, 0.43133]] as const) {
      const r = reaction(g, m);
      rel(r.ir, ir, 1e-5);
      rel(r.r0, r0, 1e-5);
    }
  });

  it('the damping polynomial reaches zero continuously at extinction (no jump just below it)', () => {
    const dry = reaction(g, 0).r0;
    expect(reaction(g, g.mx * (1 - 1e-6)).r0 / dry).toBeLessThan(1e-4);
    for (const f of BURNABLE) {
      const p = bed(f);
      expect(reaction(p, p.mx * (1 - 1e-6)).r0 / reaction(p, 0).r0, FUELS[f].name).toBeLessThan(1e-4);
    }
  });

  it('wind, slope and the wind limit', () => {
    const r = reaction(g, 0.08);
    rel(windLimit(r.ir), 942.4300415283566, 1e-5);
    rel(spreadRate(g, r, 300, 0), 0.2616220268354339, 1e-5);
    rel(spreadRate(g, r, 300, Math.tan((20 * Math.PI) / 180)), 0.39498263657390653, 1e-5);
  });
});

describe('rothermel as a rate model in the solver', () => {
  const edge = (o: Partial<EdgeInput> = {}): EdgeInput => ({ fuel: FuelClass.GRASS, moisture: 0.08, cosTheta: 1, windSpeedMps: 6, dz: 0, dist: 30, ...o });

  it('rate function: head > flank > back, uphill > flat, wet < dry, zero for non-burnable', () => {
    const rate = createRateFn(makeFixture({ settings: { rateModel: 'rothermel' } }));
    const head = rate(edge());
    const flank = rate(edge({ cosTheta: 0 }));
    const back = rate(edge({ cosTheta: -1 }));
    expect(head).toBeGreaterThan(flank * 5);
    expect(flank).toBeCloseTo(back, 12);
    expect(rate(edge({ dz: 30 }))).toBeGreaterThan(rate(edge({ dz: 0 })));
    expect(rate(edge({ dz: -30 }))).toBeCloseTo(rate(edge({ dz: 0 })), 12);
    expect(rate(edge({ moisture: 0.2 }))).toBeLessThan(rate(edge({ moisture: 0.05 })));
    expect(rate(edge({ fuel: FuelClass.NONE }))).toBe(0);
    expect(rate(edge({ moisture: FUELS[FuelClass.GRASS].extinctionMoisture }))).toBe(0);
  });

  it('global multiplier, wind strength and slope strength settings are honoured', () => {
    const mk = (settings: object) => createRateFn(makeFixture({ settings: { rateModel: 'rothermel', ...settings } }));
    expect(mk({ globalMultiplier: 2 })(edge())).toBeCloseTo(2 * mk({})(edge()), 10);
    expect(mk({ windStrength: 0 })(edge())).toBeCloseTo(mk({})(edge({ windSpeedMps: 0 })), 12);
    expect(mk({ slopeStrength: 0 })(edge({ dz: 30 }))).toBeCloseTo(mk({})(edge({ dz: 0 })), 12);
  });

  it('moisture bucketing never lets spread continue past extinction', () => {
    const rate = createRateFn(makeFixture({ settings: { rateModel: 'rothermel' } }));
    const mx = FUELS[FuelClass.GRASS].extinctionMoisture;
    for (let m = mx - 0.002; m < mx + 0.002; m += 0.00007) {
      if (m >= mx) expect(rate(edge({ moisture: m }))).toBe(0);
      else expect(rate(edge({ moisture: m }))).toBeGreaterThanOrEqual(0);
    }
  });

  it('a whole simulation: wind from the west drives the fire east, and a firebreak still stops it', () => {
    const s = makeFixture({ river: false, road: false, dryness: 'high', ignition: [{ row: 25, col: 15 }], weather: { windSpeedMps: 6, windFromDeg: 270 }, settings: { rateModel: 'rothermel' }, fuelClass: FuelClass.GRASS, durationSeconds: 3 * 3600 });
    const r = simulate(s);
    expect(r.arrivalTime[25 * 50 + 35]).toBeLessThan(Infinity);
    expect(r.arrivalTime[25 * 50 + 35]).toBeLessThan(r.arrivalTime[25 * 50 + 0] === Infinity ? Infinity : r.arrivalTime[25 * 50 + 0]);
    const cells = Array.from({ length: 50 }, (_, rr) => rr * 50 + 28);
    const blocked = simulate({ ...s, interventions: [{ id: 'b', tSeconds: 0, type: 'firebreak', cells }] });
    for (let rr = 0; rr < 50; rr++) for (let c = 28; c < 50; c++) expect(blocked.arrivalTime[rr * 50 + c]).toBe(Infinity);
  });

  it('is rejected by the validator when the model id is unknown', () => {
    const s = makeFixture();
    expect(validateScenario(s)).toEqual([]);
    expect(validateScenario({ ...s, settings: { ...s.settings, rateModel: 'bogus' as never } }).some((e) => e.includes('rateModel'))).toBe(true);
    expect(DEFAULT_SETTINGS.rateModel).toBe('factors');
    expect(applyDrynessPreset({ ...DEFAULT_WEATHER }, 'high').baseFuelMoisture).toBeGreaterThan(0);
  });
});

describe('iso model', () => {
  it('spreads at constant speed: arrival equals distance / speed up to the 8-neighbour grid error', () => {
    const speed = 0.2;
    const s = makeFixture({ river: false, road: false, ignition: [{ row: 25, col: 25 }], settings: { rateModel: 'iso', isoSpeedMps: speed }, weather: { windSpeedMps: 15, windFromDeg: 90 }, durationSeconds: 24 * 3600 });
    const { arrivalTime } = simulate(s);
    // Axis-aligned cells are exact; wind, slope and fuel are ignored.
    expect(arrivalTime[25 * 50 + 35]).toBeCloseTo((10 * 30) / speed, 1);
    expect(arrivalTime[25 * 50 + 15]).toBeCloseTo((10 * 30) / speed, 1);
    expect(arrivalTime[15 * 50 + 25]).toBeCloseTo((10 * 30) / speed, 1);
    // Pure diagonal: sqrt(2) * 10 cells.
    expect(arrivalTime[35 * 50 + 35]).toBeCloseTo((10 * Math.SQRT2 * 30) / speed, 1);
  });

  it('still respects non-burnable cells', () => {
    const s = makeFixture({ road: false, ignition: [{ row: 25, col: 10 }], settings: { rateModel: 'iso', isoSpeedMps: 0.3 }, durationSeconds: 24 * 3600 });
    const { arrivalTime } = simulate(s);
    for (let r = 0; r < 50; r++) expect(arrivalTime[r * 50 + 41]).toBe(Infinity);
  });
});
