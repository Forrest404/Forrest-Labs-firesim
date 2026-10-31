/**
 * FROZEN shared contract. Do not edit without telling the team in chat.
 * (Tuning the NUMBERS below is allowed and expected; see FEATURES.md "Sim realism".
 * Adding or renaming classes or fields is a contract change.)
 *
 * Fuel class table. Every number is a PLACEHOLDER chosen for plausible relative behaviour.
 * NOT CALIBRATED against fire observations. Two groups:
 *  - baseRateMps / color: used by the demo-tuned 'factors' model;
 *  - bed: a single-size dead fuel bed used by the 'rothermel' model, loosely following the
 *    Anderson (1982) fuel models. extinctionMoisture and burnDurationS are shared by all models.
 */

import { FuelClass } from './types';

/** Single-size dead surface fuel bed for the Rothermel model (SI units). */
export interface FuelBed {
  /** Oven-dry fuel load, kg/m^2. */
  loadKgM2: number;
  /** Surface-area-to-volume ratio of the fuel particles, 1/m. */
  savPerM: number;
  /** Fuel bed depth, m. */
  depthM: number;
  /** Fuel particle low heat content, J/kg. */
  heatContentJkg: number;
  /** Oven-dry particle density, kg/m^3. */
  particleDensityKgM3: number;
  /** Midflame wind speed as a fraction of the open 10 m wind (sheltering by canopy and fuel). */
  windReduction: number;
}

export interface FuelSpec {
  name: string;
  /** No-wind, flat, dry spread rate in m/s ('factors' model). */
  baseRateMps: number;
  /** Fuel moisture fraction at or above which this fuel does not spread fire (all models). */
  extinctionMoisture: number;
  /** How long a cell keeps burning (and can ignite neighbours) after ignition, seconds. */
  burnDurationS: number;
  /** Debug-layer colour, CSS rgba. */
  color: string;
  /** Rothermel fuel bed. Zeros for the non-burnable class. */
  bed: FuelBed;
}

const NO_BED: FuelBed = { loadKgM2: 0, savPerM: 0, depthM: 0, heatContentJkg: 0, particleDensityKgM3: 0, windReduction: 0 };
const H = 18_608_000; // 8000 Btu/lb, the standard dead-fuel heat content
const RHO = 512; // 32 lb/ft^3

export const FUELS: Record<FuelClass, FuelSpec> = {
  [FuelClass.NONE]: {
    name: 'Non-burnable',
    baseRateMps: 0,
    extinctionMoisture: 0,
    burnDurationS: 0,
    color: 'rgba(90, 100, 110, 0.55)',
    bed: NO_BED,
  },
  [FuelClass.GRASS]: {
    name: 'Grass',
    baseRateMps: 0.06,
    extinctionMoisture: 0.3,
    burnDurationS: 300,
    color: 'rgba(205, 220, 90, 0.55)',
    // ~ Anderson model 1 (short grass): 0.034 lb/ft2, 3500 1/ft, 1 ft deep.
    bed: { loadKgM2: 0.166, savPerM: 11483, depthM: 0.305, heatContentJkg: H, particleDensityKgM3: RHO, windReduction: 0.4 },
  },
  [FuelClass.SHRUB]: {
    name: 'Shrub',
    baseRateMps: 0.045,
    extinctionMoisture: 0.3,
    burnDurationS: 900,
    color: 'rgba(170, 150, 60, 0.55)',
    // ~ Anderson model 5 (brush) lumped to one dead class: 0.059 lb/ft2, 2000 1/ft, 2 ft deep.
    bed: { loadKgM2: 0.288, savPerM: 6562, depthM: 0.61, heatContentJkg: H, particleDensityKgM3: RHO, windReduction: 0.35 },
  },
  [FuelClass.FOREST_DECIDUOUS]: {
    name: 'Deciduous forest',
    baseRateMps: 0.02,
    extinctionMoisture: 0.35,
    burnDurationS: 1800,
    color: 'rgba(70, 150, 70, 0.55)',
    // ~ Anderson model 9 (hardwood litter): 0.16 lb/ft2, 2500 1/ft, 0.2 ft deep.
    bed: { loadKgM2: 0.78, savPerM: 8202, depthM: 0.061, heatContentJkg: H, particleDensityKgM3: RHO, windReduction: 0.25 },
  },
  [FuelClass.FOREST_CONIFER]: {
    name: 'Conifer forest',
    baseRateMps: 0.03,
    extinctionMoisture: 0.35,
    burnDurationS: 1800,
    color: 'rgba(20, 100, 50, 0.55)',
    // ~ Anderson model 10 (timber with understory), dead classes lumped: 0.23 lb/ft2, 2000 1/ft, 1 ft deep.
    bed: { loadKgM2: 1.12, savPerM: 6562, depthM: 0.305, heatContentJkg: H, particleDensityKgM3: RHO, windReduction: 0.25 },
  },
  [FuelClass.FARMLAND]: {
    name: 'Farmland',
    baseRateMps: 0.03,
    extinctionMoisture: 0.3,
    burnDurationS: 400,
    color: 'rgba(220, 190, 120, 0.55)',
    // Crop stubble / tall grass-like: 0.1 lb/ft2, 1500 1/ft, 2.5 ft deep.
    bed: { loadKgM2: 0.488, savPerM: 4921, depthM: 0.762, heatContentJkg: H, particleDensityKgM3: RHO, windReduction: 0.4 },
  },
};

export function isBurnable(fuel: number): boolean {
  return fuel !== FuelClass.NONE && fuel in FUELS && FUELS[fuel as FuelClass].baseRateMps > 0;
}

export function fuelSpec(fuel: number): FuelSpec {
  return FUELS[fuel as FuelClass] ?? FUELS[FuelClass.NONE];
}
