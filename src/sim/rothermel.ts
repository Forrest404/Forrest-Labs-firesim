/**
 * Rothermel (1972) surface-fire rate of spread with the Albini (1976) revisions, for a single-size
 * dead fuel bed. Written from the published equations (Rothermel 1972, USDA Forest Service
 * INT-115; Albini 1976, INT-30; wind limit from Andrews, Cruz & Rothermel 2013). Public-domain
 * science; no third-party code was copied (ForeFire is GPL, see DECISIONS.md D17).
 *
 * Internals use the paper's US units (ft, lb, Btu, min); the public functions take and return SI.
 * Fuel parameters are placeholders (see src/contract/fuels.ts). NOT validated against BehavePlus
 * or observed fires.
 */

import type { FuelBed } from '../contract';

const M_TO_FT = 3.28084;
const KGM2_TO_LBFT2 = 0.204816;
const KGM3_TO_LBFT3 = 0.062428;
const JKG_TO_BTULB = 1 / 2326;
export const FTMIN_TO_MS = 0.00508;
export const MS_TO_FTMIN = 1 / FTMIN_TO_MS;

/** Total and effective mineral content of the fuel (standard values). */
const S_TOTAL = 0.0555;
const S_EFFECTIVE = 0.01;

export interface PreparedBed {
  valid: boolean;
  /** Moisture of extinction (fraction). */
  mx: number;
  /** Packing ratio over optimum packing ratio. */
  ratio: number;
  /** Wind-factor coefficients: phiW = C * U^B * ratio^-E, U in ft/min. */
  windC: number;
  windB: number;
  windE: number;
  /** Slope-factor coefficient: phiS = slopeCoef * tan(slope)^2. */
  slopeCoef: number;
  // Reaction-intensity pieces (independent of moisture):
  gammaPrime: number; // optimum-scaled reaction velocity, 1/min
  netLoad: number; // lb/ft^2
  heat: number; // Btu/lb
  mineralDamping: number;
  // Heat-sink / propagating-flux pieces:
  xi: number; // propagating flux ratio
  rhoBulk: number; // lb/ft^3
  eps: number; // effective heating number
}

const INVALID: PreparedBed = {
  valid: false, mx: 0, ratio: 0, windC: 0, windB: 0, windE: 0, slopeCoef: 0, gammaPrime: 0,
  netLoad: 0, heat: 0, mineralDamping: 0, xi: 0, rhoBulk: 0, eps: 0,
};

export function prepareBed(bed: FuelBed, extinctionMoisture: number): PreparedBed {
  const w0 = bed.loadKgM2 * KGM2_TO_LBFT2;
  const sigma = bed.savPerM / M_TO_FT; // 1/ft
  const delta = bed.depthM * M_TO_FT;
  const heat = bed.heatContentJkg * JKG_TO_BTULB;
  const rhoP = bed.particleDensityKgM3 * KGM3_TO_LBFT3;
  if (!(w0 > 0 && sigma > 0 && delta > 0 && heat > 0 && rhoP > 0 && extinctionMoisture > 0)) return INVALID;

  const netLoad = w0 * (1 - S_TOTAL);
  const rhoBulk = w0 / delta;
  const beta = rhoBulk / rhoP;
  const betaOp = 3.348 * Math.pow(sigma, -0.8189);
  const ratio = beta / betaOp;
  const sigma15 = Math.pow(sigma, 1.5);
  const gammaMax = sigma15 / (495 + 0.0594 * sigma15);
  const A = 133 * Math.pow(sigma, -0.7913);
  const gammaPrime = gammaMax * Math.pow(ratio, A) * Math.exp(A * (1 - ratio));
  const xi = Math.exp((0.792 + 0.681 * Math.sqrt(sigma)) * (beta + 0.1)) / (192 + 0.259 * sigma);
  const eps = Math.exp(-138 / sigma);
  const mineralDamping = Math.min(1, 0.174 * Math.pow(S_EFFECTIVE, -0.19));
  return {
    valid: true,
    mx: extinctionMoisture,
    ratio,
    windC: 7.47 * Math.exp(-0.133 * Math.pow(sigma, 0.55)),
    windB: 0.02526 * Math.pow(sigma, 0.54),
    windE: 0.715 * Math.exp(-3.59e-4 * sigma),
    slopeCoef: 5.275 * Math.pow(beta, -0.3),
    gammaPrime,
    netLoad,
    heat,
    mineralDamping,
    xi,
    rhoBulk,
    eps,
  };
}

export interface Reaction {
  /** No-wind, no-slope rate of spread, ft/min. */
  r0: number;
  /** Reaction intensity, Btu/ft^2/min. */
  ir: number;
}

/** Moisture-dependent part: reaction intensity and the no-wind, no-slope rate of spread. */
export function reaction(p: PreparedBed, moisture: number): Reaction {
  if (!p.valid || moisture >= p.mx) return { r0: 0, ir: 0 };
  const rM = moisture / p.mx;
  const etaM = Math.max(0, 1 - 2.59 * rM + 5.11 * rM * rM - 3.52 * rM * rM * rM);
  const ir = p.gammaPrime * p.netLoad * p.heat * etaM * p.mineralDamping;
  const qig = 250 + 1116 * moisture; // heat of pre-ignition, Btu/lb
  const r0 = (ir * p.xi) / (p.rhoBulk * p.eps * qig);
  return { r0, ir };
}

/** Maximum useful effective wind speed, ft/min (Andrews, Cruz & Rothermel 2013). */
export function windLimit(ir: number): number {
  return 96.8 * Math.cbrt(ir);
}

/**
 * Rate of spread in a direction, m/s.
 * @param windFtMin  midflame wind component along the direction of spread, ft/min (>= 0)
 * @param tanSlope   tangent of the upslope angle along the direction (>= 0; downhill gives 0)
 */
export function spreadRate(p: PreparedBed, r: Reaction, windFtMin: number, tanSlope: number): number {
  if (!(r.r0 > 0)) return 0;
  const u = Math.max(0, windFtMin);
  const ratioTerm = Math.pow(p.ratio, -p.windE);
  const phiW = u > 0 ? p.windC * Math.pow(u, p.windB) * ratioTerm : 0;
  const t = Math.min(Math.max(0, tanSlope), 2);
  const phiS = p.slopeCoef * t * t;
  // The limit applies to the COMBINED effective wind (wind plus slope), not to wind alone:
  // phiE = phiW + phiS may not exceed the effect of the limiting wind speed.
  const phiMax = p.windC * Math.pow(windLimit(r.ir), p.windB) * ratioTerm;
  return r.r0 * (1 + Math.min(phiW + phiS, phiMax)) * FTMIN_TO_MS;
}
