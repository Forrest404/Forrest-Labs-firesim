/**
 * FROZEN shared contract. Do not edit without telling the team in chat.
 * (Tuning the NUMBERS below is allowed and expected; see FEATURES.md "Sim realism".
 * Adding or renaming classes is a contract change.)
 *
 * Fuel class table. Every number is a PLACEHOLDER chosen for plausible relative behaviour.
 * NOT CALIBRATED against Rothermel fuel models or real fires.
 */

import { FuelClass } from './types';

export interface FuelSpec {
  name: string;
  /** No-wind, flat, dry spread rate in m/s. */
  baseRateMps: number;
  /** Fuel moisture fraction at or above which this fuel does not spread fire. */
  extinctionMoisture: number;
  /** How long a cell keeps burning (and can ignite neighbours) after ignition, seconds. */
  burnDurationS: number;
  /** Debug-layer colour, CSS rgba. */
  color: string;
}

export const FUELS: Record<FuelClass, FuelSpec> = {
  [FuelClass.NONE]: {
    name: 'Non-burnable',
    baseRateMps: 0,
    extinctionMoisture: 0,
    burnDurationS: 0,
    color: 'rgba(90, 100, 110, 0.55)',
  },
  [FuelClass.GRASS]: {
    name: 'Grass',
    baseRateMps: 0.06,
    extinctionMoisture: 0.3,
    burnDurationS: 300,
    color: 'rgba(205, 220, 90, 0.55)',
  },
  [FuelClass.SHRUB]: {
    name: 'Shrub',
    baseRateMps: 0.045,
    extinctionMoisture: 0.3,
    burnDurationS: 900,
    color: 'rgba(170, 150, 60, 0.55)',
  },
  [FuelClass.FOREST_DECIDUOUS]: {
    name: 'Deciduous forest',
    baseRateMps: 0.02,
    extinctionMoisture: 0.35,
    burnDurationS: 1800,
    color: 'rgba(70, 150, 70, 0.55)',
  },
  [FuelClass.FOREST_CONIFER]: {
    name: 'Conifer forest',
    baseRateMps: 0.03,
    extinctionMoisture: 0.35,
    burnDurationS: 1800,
    color: 'rgba(20, 100, 50, 0.55)',
  },
  [FuelClass.FARMLAND]: {
    name: 'Farmland',
    baseRateMps: 0.03,
    extinctionMoisture: 0.3,
    burnDurationS: 400,
    color: 'rgba(220, 190, 120, 0.55)',
  },
};

export function isBurnable(fuel: number): boolean {
  return fuel !== FuelClass.NONE && fuel in FUELS && FUELS[fuel as FuelClass].baseRateMps > 0;
}

export function fuelSpec(fuel: number): FuelSpec {
  return FUELS[fuel as FuelClass] ?? FUELS[FuelClass.NONE];
}
