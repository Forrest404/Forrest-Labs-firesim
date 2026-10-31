/**
 * Emergency-response resources and response levels. Pure data, worker-safe (no DOM, no Cesium).
 *
 * Every tactic maps onto the two frozen intervention types: hand and dozer lines are `firebreak`
 * one cell wide; engine wet lines, helicopter buckets and airtanker retardant are `water` with
 * per-unit moisture boost and half-life (retardant = long half-life). Numbers are order-of-magnitude
 * realistic (see DECISIONS.md D24), not calibrated.
 */

import { FuelClass } from '../contract';

export type UnitType = 'handcrew' | 'engine' | 'dozer' | 'helicopter' | 'airtanker';
export type Tactic = 'handline' | 'dozerline' | 'wetline' | 'bucket' | 'retardant';
export type ResponseLevel = 'minimal' | 'standard' | 'aggressive' | 'maximum';

export const UNIT_TYPES: UnitType[] = ['handcrew', 'engine', 'dozer', 'helicopter', 'airtanker'];
export const RESPONSE_LEVELS: ResponseLevel[] = ['minimal', 'standard', 'aggressive', 'maximum'];

export interface UnitSpec {
  type: UnitType;
  label: string;
  tactic: Tactic;
  /** Base to grid entry, km/h (roads for ground units, air speed for aircraft). */
  travelKmh: number;
  /** Entry cell to the line and between lines, km/h (crews walk, engines drive tracks). */
  onGridKmh: number;
  /** Line production in light fuel, metres per minute (0 for aircraft). */
  lineRateMpm: number;
  /** Aircraft: cells covered per drop (one cell wide). */
  dropCells: number;
  /** Aircraft: reload cycle. Ground: rest and relocation between lines. Seconds. */
  turnaroundS: number;
  /** Water or retardant carried per load, litres (informational). */
  waterL: number;
  /** Water-type params; unused for firebreak tactics. */
  boost: number;
  halfLifeS: number;
  /** The tactic is not allowed within this Chebyshev distance (cells) of a home. */
  homesClearanceCells: number;
  /** False: never cuts through forest cells unless the level overrides it. */
  forestAllowed: boolean;
  airborne: boolean;
}

export const UNITS: Record<UnitType, UnitSpec> = {
  handcrew: { type: 'handcrew', label: 'Hand crew', tactic: 'handline', travelKmh: 50, onGridKmh: 4, lineRateMpm: 15, dropCells: 0, turnaroundS: 600, waterL: 0, boost: 0, halfLifeS: 0, homesClearanceCells: 0, forestAllowed: true, airborne: false },
  engine: { type: 'engine', label: 'Engine', tactic: 'wetline', travelKmh: 65, onGridKmh: 20, lineRateMpm: 12, dropCells: 0, turnaroundS: 1200, waterL: 2800, boost: 0.35, halfLifeS: 5400, homesClearanceCells: 0, forestAllowed: true, airborne: false },
  dozer: { type: 'dozer', label: 'Dozer', tactic: 'dozerline', travelKmh: 40, onGridKmh: 8, lineRateMpm: 40, dropCells: 0, turnaroundS: 900, waterL: 0, boost: 0, halfLifeS: 0, homesClearanceCells: 3, forestAllowed: false, airborne: false },
  helicopter: { type: 'helicopter', label: 'Helicopter', tactic: 'bucket', travelKmh: 180, onGridKmh: 180, lineRateMpm: 0, dropCells: 3, turnaroundS: 420, waterL: 1200, boost: 0.3, halfLifeS: 1200, homesClearanceCells: 0, forestAllowed: true, airborne: true },
  airtanker: { type: 'airtanker', label: 'Airtanker', tactic: 'retardant', travelKmh: 230, onGridKmh: 230, lineRateMpm: 0, dropCells: 8, turnaroundS: 2700, waterL: 4500, boost: 0.6, halfLifeS: 21600, homesClearanceCells: 0, forestAllowed: true, airborne: true },
};

/** Line production multiplier by fuel class (index = FuelClass). NONE is a free tie-in. */
export const FUEL_RATE_FACTOR: Record<FuelClass, number> = {
  [FuelClass.NONE]: Infinity,
  [FuelClass.GRASS]: 1.3,
  [FuelClass.SHRUB]: 0.8,
  [FuelClass.FOREST_DECIDUOUS]: 0.6,
  [FuelClass.FOREST_CONIFER]: 0.5,
  [FuelClass.FARMLAND]: 1.1,
};

/** Share of a firebreak cell that counts as "cleared" vegetation, by fuel class. */
export const CLEAR_WEIGHT: Record<FuelClass, number> = {
  [FuelClass.NONE]: 0,
  [FuelClass.GRASS]: 0.15,
  [FuelClass.SHRUB]: 0.4,
  [FuelClass.FOREST_DECIDUOUS]: 1,
  [FuelClass.FOREST_CONIFER]: 1,
  [FuelClass.FARMLAND]: 0.15,
};

export type Roster = Record<UnitType, number>;

export interface LevelSpec {
  level: ResponseLevel;
  /** Detection, reporting and dispatch delay before any unit leaves its base. */
  delayS: number;
  roster: Roster;
  /** How many assignments each unit may work through the run. */
  cycles: number;
  /** Longest line one ground unit builds per assignment, metres. */
  lineBudgetM: number;
  /** Aircraft drops per assignment. */
  dropsPerSortie: number;
  /** Candidate lines evaluated per unit type per cycle. */
  candidates: number;
  dozerInForest: boolean;
  /** Hectares of saved burn one hectare of cleared vegetation must buy. */
  cutPenalty: number;
}

export const LEVELS: Record<ResponseLevel, LevelSpec> = {
  minimal: { level: 'minimal', delayS: 2700, roster: { handcrew: 1, engine: 1, dozer: 0, helicopter: 0, airtanker: 0 }, cycles: 2, lineBudgetM: 300, dropsPerSortie: 0, candidates: 8, dozerInForest: false, cutPenalty: 1.5 },
  standard: { level: 'standard', delayS: 1200, roster: { handcrew: 2, engine: 2, dozer: 0, helicopter: 1, airtanker: 0 }, cycles: 3, lineBudgetM: 500, dropsPerSortie: 4, candidates: 8, dozerInForest: false, cutPenalty: 1.25 },
  aggressive: { level: 'aggressive', delayS: 600, roster: { handcrew: 3, engine: 3, dozer: 1, helicopter: 2, airtanker: 1 }, cycles: 4, lineBudgetM: 800, dropsPerSortie: 6, candidates: 8, dozerInForest: true, cutPenalty: 1.0 },
  maximum: { level: 'maximum', delayS: 300, roster: { handcrew: 4, engine: 4, dozer: 2, helicopter: 3, airtanker: 2 }, cycles: 5, lineBudgetM: 1500, dropsPerSortie: 8, candidates: 8, dozerInForest: true, cutPenalty: 0.8 },
};

/** Advanced-panel overrides on top of a preset. Absent fields keep the preset's value. */
export interface ContainOverrides {
  delayS?: number;
  cycles?: number;
  lineBudgetM?: number;
  roster?: Partial<Roster>;
}

export function resolveLevel(level: ResponseLevel, overrides: ContainOverrides | null | undefined): LevelSpec {
  const base = LEVELS[level];
  if (!overrides) return base;
  return {
    ...base,
    delayS: overrides.delayS ?? base.delayS,
    cycles: overrides.cycles ?? base.cycles,
    lineBudgetM: overrides.lineBudgetM ?? base.lineBudgetM,
    roster: { ...base.roster, ...overrides.roster },
  };
}

export function isForest(fuel: number): boolean {
  return fuel === FuelClass.FOREST_DECIDUOUS || fuel === FuelClass.FOREST_CONIFER;
}
