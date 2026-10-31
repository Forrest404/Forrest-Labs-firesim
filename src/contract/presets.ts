/**
 * FROZEN shared contract. Do not edit without telling the team in chat.
 * (Tuning the NUMBERS is allowed; see FEATURES.md "Settings and presets polish".)
 *
 * Simple-mode dryness presets are DATA. Choosing a preset writes these values into the same
 * Weather object the advanced panel edits, so there is no separate preset logic anywhere.
 */

import type { DrynessPreset, SimSettings, Weather } from './types';

export interface DrynessPresetValues {
  label: string;
  temperatureC: number;
  /** Fraction 0-1. */
  relativeHumidity: number;
}

export const DRYNESS_PRESETS: Record<DrynessPreset, DrynessPresetValues> = {
  low: { label: 'Low', temperatureC: 15, relativeHumidity: 0.6 },
  medium: { label: 'Medium', temperatureC: 22, relativeHumidity: 0.4 },
  high: { label: 'High', temperatureC: 30, relativeHumidity: 0.25 },
  extreme: { label: 'Extreme', temperatureC: 38, relativeHumidity: 0.08 },
};

export const DRYNESS_PRESET_ORDER: DrynessPreset[] = ['low', 'medium', 'high', 'extreme'];

/**
 * Dead fuel moisture from temperature and humidity. A linear stand-in with the right trend
 * (wetter when humid, drier when hot). Placeholder, not a fuel-moisture model.
 * low -> ~0.18, medium -> ~0.12, high -> ~0.08, extreme -> ~0.04.
 */
export function deriveFuelMoisture(temperatureC: number, relativeHumidity: number): number {
  const m = 0.025 + 0.25 * relativeHumidity - 0.0005 * (temperatureC - 20);
  return Math.min(0.3, Math.max(0.02, m));
}

/** Returns a new Weather with the preset's temperature, humidity and derived moisture applied. */
export function applyDrynessPreset(weather: Weather, preset: DrynessPreset): Weather {
  const p = DRYNESS_PRESETS[preset];
  return {
    ...weather,
    temperatureC: p.temperatureC,
    relativeHumidity: p.relativeHumidity,
    baseFuelMoisture: deriveFuelMoisture(p.temperatureC, p.relativeHumidity),
  };
}

export const DEFAULT_WEATHER: Weather = {
  windSpeedMps: 6,
  windFromDeg: 270,
  temperatureC: DRYNESS_PRESETS.high.temperatureC,
  relativeHumidity: DRYNESS_PRESETS.high.relativeHumidity,
  baseFuelMoisture: deriveFuelMoisture(
    DRYNESS_PRESETS.high.temperatureC,
    DRYNESS_PRESETS.high.relativeHumidity,
  ),
  windVariabilityDeg: 0,
};

export const DEFAULT_SETTINGS: SimSettings = {
  rateModel: 'factors',
  isoSpeedMps: 0.1,
  neighbourhood: 16,
  globalMultiplier: 1,
  windStrength: 1,
  windExponent: 0.8,
  slopeStrength: 1,
  waterHalfLifeS: 600,
  waterMoistureBoost: 0.5,
  burnoutEnabled: true,
  spottingEnabled: false,
  spottingIntensityKwM: 2000,
  spottingEmbers: 2,
  spottingRangeScale: 1,
  // Chosen so spotting is clearly visible in a 3 h demo (about 2-5x the area at 10 m/s) without
  // engulfing the map; the real value is highly uncertain and far smaller per ember.
  spottingIgnitionProb: 0.02,
};

/** 6 simulated hours. */
export const DEFAULT_DURATION_SECONDS = 6 * 3600;
