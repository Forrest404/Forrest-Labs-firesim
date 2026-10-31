/**
 * FROZEN shared contract. Do not edit without telling the team in chat.
 *
 * This file is the backbone that connects data building, the simulation, the viewer and the
 * tools. Everything else may change freely; changes here ripple through every module.
 * Conventions (units, orientation, wind direction, sentinels) are documented in conventions.ts.
 */

/** Fuel class per cell. 0 is non-burnable and is also the "no data" value. */
export enum FuelClass {
  /** Water, roads, buildings, bare rock, cleared firebreaks, outside coverage. Never ignites. */
  NONE = 0,
  GRASS = 1,
  SHRUB = 2,
  FOREST_DECIDUOUS = 3,
  FOREST_CONIFER = 4,
  FARMLAND = 5,
}

export const FUEL_CLASS_COUNT = 6;

/** Geographic bounds in degrees (WGS84). */
export interface GridBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * Grid geometry. Cells are square in metres on an equirectangular approximation centred on
 * the grid. Row 0 is the NORTH edge, column 0 is the WEST edge. Index = row * width + col.
 */
export interface GridSpec {
  width: number;
  height: number;
  /** Cell edge in metres (default 30). */
  cellSizeM: number;
  /** Longitude of the north-west corner, degrees. */
  originLon: number;
  /** Latitude of the north-west corner, degrees. */
  originLat: number;
  /** Convenience: bounds of the whole grid, derived from origin, size and cell size. */
  bounds: GridBounds;
}

export interface CellRef {
  row: number;
  col: number;
}

export interface Weather {
  /** Wind speed in m/s (UI may show km/h but converts at the edge). */
  windSpeedMps: number;
  /** Direction the wind blows FROM, degrees clockwise from north (meteorological). */
  windFromDeg: number;
  temperatureC: number;
  /** Relative humidity as a fraction 0-1 (not percent). */
  relativeHumidity: number;
  /** Dead fuel moisture as a fraction of dry weight, 0-1. */
  baseFuelMoisture: number;
  /** Optional seeded perturbation of wind direction, degrees (advanced; default 0). */
  windVariabilityDeg?: number;
}

export type InterventionType = 'firebreak' | 'water';

export interface InterventionParams {
  /** Water only: moisture added at t = tSeconds, fraction 0-1. Defaults to settings.waterMoistureBoost. */
  moistureBoost?: number;
  /** Water only: decay half-life in seconds. Defaults to settings.waterHalfLifeS. */
  halfLifeS?: number;
  /** Informational: brush width or radius used to produce `cells`. */
  widthCells?: number;
  radiusCells?: number;
}

/** A timestamped firefighting action. Replayable: the sim re-runs from t=0 with all events. */
export interface Intervention {
  id: string;
  /** Simulated time at which the action takes effect, seconds from ignition. */
  tSeconds: number;
  type: InterventionType;
  /** Affected cell indices (row * width + col). */
  cells: number[];
  params?: InterventionParams;
  /** Optional UI label. */
  label?: string;
}

/**
 * Rate-of-spread model. 'factors' is the demo-tuned product of simple factors (default),
 * 'rothermel' is the Rothermel (1972) / Albini (1976) surface-fire model on single-size fuel beds,
 * 'iso' is a constant speed everywhere (for tests and grid-error checks).
 */
export type RateModelId = 'factors' | 'rothermel' | 'iso';

/** Tuning knobs. All values are placeholders, not calibrated against real fires. */
export interface SimSettings {
  /** Which rate-of-spread model drives the simulation. */
  rateModel: RateModelId;
  /** 'iso' model only: constant spread speed in m/s. */
  isoSpeedMps: number;
  /** Spread directions per cell: 8 (king moves) or 16 (adds knight moves, rounder fires). */
  neighbourhood: 8 | 16;
  /** Scales every spread rate. */
  globalMultiplier: number;
  /** Magnitude of the wind effect (0 disables wind). */
  windStrength: number;
  /** Exponent on wind speed; < 1 gives diminishing returns. */
  windExponent: number;
  /** Magnitude of the slope effect (0 disables slope). */
  slopeStrength: number;
  /** Default decay half-life of sprayed water, seconds. */
  waterHalfLifeS: number;
  /** Default moisture added by water spray, fraction 0-1. */
  waterMoistureBoost: number;
  /** If true, a cell stops spreading after its fuel's burn duration (affects delayed ignition through drying cells). */
  burnoutEnabled: boolean;
  /** Stub. Ember spotting is not implemented in v0; must be false. */
  spottingEnabled: boolean;
}

export interface Scenario {
  grid: GridSpec;
  /** FuelClass per cell, length width * height. */
  fuel: Uint8Array;
  /** Elevation in metres per cell. Must be finite; the builder fills gaps before handing over. */
  elevation: Float32Array;
  /** Optional hook for future fuel-load scaling. Unused in v0. Metres. */
  canopyHeight?: Float32Array;
  weather: Weather;
  /** Ignition cells at t = 0. The UI uses exactly one. */
  ignition: CellRef[];
  interventions: Intervention[];
  /** Simulated duration in seconds. Arrival times beyond it are reported as never. */
  durationSeconds: number;
  /** Integer seed. The sim is deterministic for a given scenario and seed. */
  seed: number;
  settings: SimSettings;
}

export interface SimStats {
  burnedCells: number;
  burnedAreaHa: number;
  /** Fastest cell-to-cell spread rate observed, m/s. */
  maxSpreadRateMps: number;
  /** Largest Byram fireline intensity, kW/m (indicative, see SimResult.firelineIntensityKwM). */
  maxIntensityKwM: number;
  /** Largest Byram flame length, m. */
  maxFlameLengthM: number;
  runtimeMs: number;
}

export interface SimResult {
  /**
   * Seconds after ignition at which each cell ignites, length width * height.
   * NEVER_ARRIVES (Infinity) if the cell never burns within durationSeconds.
   * Playback reads only this: a cell is burning at time t if arrivalTime[i] <= t.
   */
  arrivalTime: Float32Array;
  /** Optional relative spread strength at ignition, 0-1. Not a physical intensity. */
  intensity?: Float32Array;
  /**
   * Byram fireline intensity at ignition, kW/m: heat content x fuel load x spread rate (H w R),
   * using the fuel bed in the fuel table and the spread rate along the edge that ignited the cell
   * (head > flank > back). Zero for cells that never burn. Indicative, not calibrated.
   */
  firelineIntensityKwM: Float32Array;
  /** Byram (1959) flame length, m: 0.0775 I^0.46 with I in kW/m. Zero for cells that never burn. */
  flameLengthM: Float32Array;
  stats: SimStats;
}

export type DrynessPreset = 'low' | 'medium' | 'high' | 'extreme';
