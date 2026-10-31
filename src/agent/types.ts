/**
 * PHASE 0 — Shared Tactical Agent Contract.
 * Connects Logistics & Routing (Agent 1), Hybrid Counterfactual Tactic Optimizer (Agent 2),
 * Server-Side Tactic & Radio Script Agent (Agent 3), and 3D Cesium / HUD Pop-up UI (Agent 4).
 */

import type { CellRef, Intervention } from '../contract';

export type UnitType = 'engine' | 'helicopter' | 'airtanker';

export type TacticType = 'water' | 'firebreak';

export type GeminiVoicePreset = 'Kore' | 'Fenrir' | 'Puck' | 'Charon';

export interface StationCrewPersona {
  /** Familiar generic crew lead name (e.g. "Sarah Miller", "Mike Vance"). */
  crewLeadName: string;
  /** Station call label used in radio intro (e.g. "Station 14", "Station 4 Helibase"). */
  stationCallLabel: string;
  /** Short radio callsign (e.g. "Engine 14", "Helitack 4"). */
  callsign: string;
  /** Dedicated Gemini voice preset assigned to this station crew. */
  voicePreset: GeminiVoicePreset;
  /** Acoustic pitch multiplier for voice synthesis differentiation (0.85 - 1.15). */
  voicePitch: number;
  /** Brisk wildfire dispatcher/crew speaking rate (1.05 - 1.16). */
  voiceRate: number;
}

export interface TacticComparisonMetrics {
  waterSavedHa: number;
  firebreakSavedHa: number;
  /** Hectares of trees/forest cleared if the Fire Break tactic is executed on this arc. */
  deforestedHa: number;
  /** Extra wildfire spread (ha) that would occur if trees are NOT cut (firebreakSavedHa - waterSavedHa). */
  uncontainedSpreadIfNoFirebreakHa: number;
  /** Water volume (L) dropped by the fire-truck-calibrated unit. */
  waterDropLiters: number;
  selectedTactic: TacticType;
  dominantFuelClass: number;
  dominantFuelLabel: string;
  meanSlopeDeg: number;
  /** Short, sharp 1-line tactical explanation of why Water Spray or Fire Break was selected. */
  tacticRationale: string;
}

export interface RadioCalloutEvent {
  id: string;
  orderId: string;
  triggerTimeSeconds: number;
  endTimeSeconds: number;
  phase: 'dispatch' | 'executing_tactic' | 'dip_refill';
  unitName: string;
  unitType: UnitType;
  callsign: string;
  crewLeadName: string;
  stationCallLabel: string;
  wave: 1 | 2;
  tacticType: TacticType;
  sectorLabel: string;
  /** Short, sharp radio transmission transcript. Dispatch always starts with "This is [Name] calling from [Station]..." */
  transcript: string;
  voicePreset: GeminiVoicePreset;
  voicePitch: number;
  voiceRate: number;
  focusLonLat: [number, number];
}

export interface FireStationAsset {
  id: string;
  name: string;
  unitType: UnitType;
  /** Station geographic coordinates (WGS84 degrees). */
  lon: number;
  lat: number;
  /** Straight-line distance from station to grid center, km. */
  distanceKm: number;
  /** Effective route distance (OSRM road km for engines, flight km for aircraft). */
  routeDistanceKm: number;
  /** Effective transit speed, km/h (calibrated to average fire truck speed: 55 km/h). */
  speedKmh: number;
  /** Standard fire truck water tank drop capacity in liters (2,500 L / ~660 gal). */
  waterCapacityLiters: number;
  /** Initial transit duration from station to the fire sector, seconds. */
  travelTimeSeconds: number;
  /** How transit time was calculated. */
  routingMethod: 'osrm' | 'tortuosity' | 'direct';
  /** Closest grid perimeter entry cell where the unit enters the simulation box. */
  entryCell: CellRef;
  entryLonLat: { lon: number; lat: number };
  /** Ordered road or flight waypoints [[lon, lat], ...] from station entry toward grid. */
  routeWaypointsLonLat?: [number, number][];
  /** Dedicated crew lead persona & voice profile for this station. */
  crewPersona?: StationCrewPersona;
  /** Spray brush radius in cells (30 m per cell). */
  waterRadiusCells: number;
  /** Swath length in cells. */
  dropLengthCells: number;
  /** Moisture boost added at drop time (0-1). */
  moistureBoost: number;
  /** Moisture decay half-life in seconds. */
  halfLifeS: number;
  /** Refill / turnaround time for Wave 2 follow-up drops, seconds. */
  turnaroundSeconds: number;
  /** Data origin. */
  source: 'overpass' | 'fallback';
}

/** On-grid river, lake, or pond cell cluster used by helicopters for rapid Wave 2 dipping. */
export interface DipSite {
  row: number;
  col: number;
  lon: number;
  lat: number;
  label: string;
  /** Helicopter round-trip dip + shuttle turnaround time in seconds. */
  turnaroundSeconds: number;
}

/** Single entry in the Live Agent Reasoning Log showing tested rollouts and selections. */
export interface ReasoningStep {
  stepIndex: number;
  phase: 'logistics' | 'rollout' | 'selection' | 'briefing';
  unitName: string;
  wave: 1 | 2;
  testedTactic?: TacticType;
  sectorLabel: string;
  etaSeconds: number;
  candidateCellsCount: number;
  projectedBurnedHa: number;
  marginalSavedHa: number;
  selected: boolean;
  summary: string;
}

/** A single recommended ground or aerial intervention order (Wave 1 or Wave 2). */
export interface AgentDispatchOrder {
  id: string;
  unit: FireStationAsset;
  wave: 1 | 2;
  /** Wave 1 originates from 'station'; Helicopter Wave 2 originates from on-grid 'dip_site'. */
  sourceType: 'station' | 'dip_site';
  sourceLonLat: { lon: number; lat: number };
  dropCenterCell: CellRef;
  dropCenterLonLat: { lon: number; lat: number };
  /** Cell-space stroke points [[col, row], ...] used to construct the water or firebreak swath. */
  strokePoints: [number, number][];
  /** Selected tactic ('water' spray or 'firebreak' cleared line). */
  tacticType: TacticType;
  /** Counterfactual comparison between Water Spray and Fire Break on this arc. */
  tacticComparison: TacticComparisonMetrics;
  /** Dedicated station crew lead persona and voice profile. */
  crewPersona: StationCrewPersona;
  /** Ready-to-apply simulator Intervention (either 'water' or 'firebreak'). */
  intervention: Intervention;
  /** Simulated timestamp (seconds after ignition) when the unit departs for this wave. */
  dispatchTimeSeconds: number;
  /** Simulated timestamp (seconds after ignition) when the unit arrives on the line and begins its tactic. */
  etaSeconds: number;
  /** Duration in simulated seconds required to traverse the containment arc and complete the drop/firebreak. */
  executionDurationSeconds: number;
  /** Ordered lon/lat waypoints from source to drop arc start for smooth 3D road/flight animation. */
  routeWaypointsLonLat: [number, number][];
  /** Time-synchronized radio callouts for dispatch, on-scene execution, and helicopter dip refill. */
  radioCallouts: RadioCalloutEvent[];
  /** Compass sector and tactical role (e.g. "ENE Head Fire", "North Upslope Flank"). */
  sectorLabel: string;
  /** Marginal hectares saved by this specific wave order during counterfactual rollout. */
  marginalSavedHa: number;
  /** Short, sharp tactical rationale. */
  rationale: string;
  /** User toggle to include/exclude this order before deploying. */
  enabled: boolean;
}

export interface TacticalPlanResult {
  orders: AgentDispatchOrder[];
  dipSite: DipSite | null;
  reasoningLog: ReasoningStep[];
  baselineBurnedHa: number;
  projectedBurnedHa: number;
  savedHa: number;
  reductionPct: number;
  /** Total forest area (ha) cleared by selected Fire Break orders across the plan. */
  totalDeforestedHa: number;
  /** Total water volume (L) dropped by selected Water Spray orders (at 2,500 L per fire truck tank). */
  totalWaterDroppedLiters: number;
  commanderBriefing: string;
  briefingSource: 'gemini' | 'fallback';
  computedInMs: number;
}

/** Payload sent to POST /api/tactical-briefing */
export interface TacticalBriefingRequest {
  areaLabel: string;
  windSpeedKmh: number;
  windTowardDeg: number;
  temperatureC: number;
  relativeHumidityPct: number;
  baselineBurnedHa: number;
  projectedBurnedHa: number;
  savedHa: number;
  reductionPct: number;
  totalDeforestedHa?: number;
  totalWaterDroppedLiters?: number;
  dipSiteLabel: string | null;
  orders: {
    id: string;
    unitName: string;
    unitType: UnitType;
    wave: 1 | 2;
    sourceType: 'station' | 'dip_site';
    etaMinutes: number;
    sectorLabel: string;
    cellsCount: number;
    marginalSavedHa: number;
    tacticType?: TacticType;
    waterSavedHa?: number;
    firebreakSavedHa?: number;
    deforestedHa?: number;
    waterDropLiters?: number;
    dominantFuelLabel?: string;
    meanSlopeDeg?: number;
    crewLeadName?: string;
    stationCallLabel?: string;
    callsign?: string;
    voicePreset?: GeminiVoicePreset;
  }[];
}

/** Structured JSON response returned by POST /api/tactical-briefing */
export interface TacticalBriefingResponse {
  commanderBriefing: string;
  orderRationales: {
    id: string;
    rationale: string;
    selectedTactic?: TacticType;
    tacticRationale?: string;
    dispatchTranscript?: string;
    executingTranscript?: string;
    refillTranscript?: string;
  }[];
  source: 'gemini' | 'fallback';
}
