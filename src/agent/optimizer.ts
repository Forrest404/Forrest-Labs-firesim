/**
 * AGENT 2 — Multi-Wave Hybrid Counterfactual Tactic Optimizer (Water Spray vs. Fire Break),
 * Station Crew Radio Callout Generator & Kinematic Trajectory Interpolator.
 * Pure simulation & mathematical optimization module (no DOM, no Cesium imports).
 */

import { FuelClass, NEVER_ARRIVES, windTowardDeg } from '../contract';
import type { CellRef, GridSpec, Intervention, Scenario, SimResult } from '../contract';
import type { DemoArea } from '../data/bundle';
import { cellCenterLonLat } from '../data/geo';
import type { Pt } from '../data/raster';
import { computeSlopeAspect } from '../data/terrain';
import { simulate } from '../sim';
import { makeFirebreak } from '../tools/firebreak';
import { makeWater } from '../tools/water';
import { assignStationCrewPersona, buildCurvedRoadWaypoints } from './logistics';
import type {
  AgentDispatchOrder,
  DipSite,
  FireStationAsset,
  RadioCalloutEvent,
  ReasoningStep,
  StationCrewPersona,
  TacticComparisonMetrics,
  TacticalPlanResult,
  TacticType,
} from './types';

const COMPASS_SECTORS: ReadonlyArray<{ code: string; label: string; angleDeg: number }> = [
  { code: 'N', label: 'North Sector', angleDeg: 0 },
  { code: 'NE', label: 'North-East Sector', angleDeg: 45 },
  { code: 'E', label: 'East Sector', angleDeg: 90 },
  { code: 'SE', label: 'South-East Sector', angleDeg: 135 },
  { code: 'S', label: 'South Sector', angleDeg: 180 },
  { code: 'SW', label: 'South-West Sector', angleDeg: 225 },
  { code: 'W', label: 'West Sector', angleDeg: 270 },
  { code: 'NW', label: 'North-West Sector', angleDeg: 315 },
];

const FUEL_LABELS: Record<number, string> = {
  [FuelClass.NONE]: 'Non-burnable',
  [FuelClass.GRASS]: 'dry grass',
  [FuelClass.SHRUB]: 'dense chaparral shrub',
  [FuelClass.FOREST_DECIDUOUS]: 'hardwood timber',
  [FuelClass.FOREST_CONIFER]: 'heavy conifer stand',
  [FuelClass.FARMLAND]: 'cured pasture',
};

interface CandidateArc {
  sectorCode: string;
  sectorLabel: string;
  centerCell: CellRef;
  strokePoints: [number, number][];
  waterIntervention: Intervention;
  firebreakIntervention: Intervention;
  dominantFuelClass: number;
  dominantFuelLabel: string;
  meanSlopeDeg: number;
  roadProximityScore: number;
  /** Number of forest canopy cells (Deciduous/Conifer) inside the candidate firebreak swath. */
  forestCellsCut: number;
  /** Hectares of trees/woody canopy cleared if the firebreak tactic is chosen. */
  deforestedHa: number;
}

function angularDiffDeg(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Builds the short, sharp wildfire radio callouts for an order.
 * Every initial dispatch transmission opens with:
 * "This is [Name] calling from [Station]..."
 */
export function buildOrderRadioCallouts(
  orderId: string,
  unit: FireStationAsset,
  crew: StationCrewPersona,
  wave: 1 | 2,
  sourceType: 'station' | 'dip_site',
  tacticType: TacticType,
  sectorLabel: string,
  dominantFuelLabel: string,
  dispatchTimeSeconds: number,
  etaSeconds: number,
  executionDurationSeconds: number,
  sourceLonLat: { lon: number; lat: number },
  dropCenterLonLat: { lon: number; lat: number },
  dipSite: DipSite | null,
): RadioCalloutEvent[] {
  const etaMin = Math.max(1, Math.round((etaSeconds - dispatchTimeSeconds) / 60));
  const waterLiters = unit.waterCapacityLiters ?? 2500;
  const actionPhrase =
    tacticType === 'firebreak'
      ? `cutting surgical firebreak across ${dominantFuelLabel} to stop breakaway spread`
      : `laying ${waterLiters}L fire-truck water spray on ${dominantFuelLabel} (0 trees cut)`;

  const dispatchTranscript =
    wave === 2 && sourceType === 'dip_site'
      ? `This is ${crew.crewLeadName} calling from ${crew.stationCallLabel} — ${waterLiters}L tank refilled, inbound to ${sectorLabel}. ${
          tacticType === 'firebreak' ? 'Cutting emergency containment line' : `Laying Wave 2 ${waterLiters}L water spray`
        }, ETA ${etaMin} min.`
      : `This is ${crew.crewLeadName} calling from ${crew.stationCallLabel} — rolling ${crew.callsign} at ${unit.speedKmh} km/h to ${sectorLabel}, ${actionPhrase}, ETA ${etaMin} min.`;

  const executingTranscript =
    tacticType === 'firebreak'
      ? `${crew.crewLeadName}, ${crew.stationCallLabel} on ${sectorLabel} — cutting minimal-footprint firebreak now to prevent wider burn.`
      : `${crew.crewLeadName}, ${crew.stationCallLabel} on ${sectorLabel} — pumping ${waterLiters}L water spray knockdown now, preserving canopy.`;

  const events: RadioCalloutEvent[] = [
    {
      id: `${orderId}-radio-dispatch`,
      orderId,
      triggerTimeSeconds: dispatchTimeSeconds,
      endTimeSeconds: Math.min(etaSeconds - 5, dispatchTimeSeconds + 180),
      phase: 'dispatch',
      unitName: unit.name,
      unitType: unit.unitType,
      callsign: crew.callsign,
      crewLeadName: crew.crewLeadName,
      stationCallLabel: crew.stationCallLabel,
      wave,
      tacticType,
      sectorLabel,
      transcript: dispatchTranscript,
      voicePreset: crew.voicePreset,
      voicePitch: crew.voicePitch,
      voiceRate: crew.voiceRate,
      focusLonLat: [sourceLonLat.lon, sourceLonLat.lat],
    },
    {
      id: `${orderId}-radio-exec`,
      orderId,
      triggerTimeSeconds: etaSeconds,
      endTimeSeconds: etaSeconds + executionDurationSeconds,
      phase: 'executing_tactic',
      unitName: unit.name,
      unitType: unit.unitType,
      callsign: crew.callsign,
      crewLeadName: crew.crewLeadName,
      stationCallLabel: crew.stationCallLabel,
      wave,
      tacticType,
      sectorLabel,
      transcript: executingTranscript,
      voicePreset: crew.voicePreset,
      voicePitch: crew.voicePitch,
      voiceRate: crew.voiceRate,
      focusLonLat: [dropCenterLonLat.lon, dropCenterLonLat.lat],
    },
  ];

  // If this is a Wave 2 helicopter dip-site order, prepend the dip-site shuttle refill callout
  if (wave === 2 && sourceType === 'dip_site' && dipSite) {
    const refillStart = Math.max(0, dispatchTimeSeconds - 95);
    events.unshift({
      id: `${orderId}-radio-dip`,
      orderId,
      triggerTimeSeconds: refillStart,
      endTimeSeconds: dispatchTimeSeconds,
      phase: 'dip_refill',
      unitName: unit.name,
      unitType: unit.unitType,
      callsign: crew.callsign,
      crewLeadName: crew.crewLeadName,
      stationCallLabel: crew.stationCallLabel,
      wave: 2,
      tacticType,
      sectorLabel: dipSite.label,
      transcript: `This is ${crew.crewLeadName} calling from ${crew.stationCallLabel} — Wave 1 tank dry, refilling ${waterLiters}L at ${dipSite.label} for Wave 2.`,
      voicePreset: crew.voicePreset,
      voicePitch: crew.voicePitch,
      voiceRate: crew.voiceRate,
      focusLonLat: [dipSite.lon, dipSite.lat],
    });
  }

  return events;
}

/**
 * Extracts candidate containment arcs along the predicted fire front isochrone at `etaSeconds`,
 * constructing both a Water Spray intervention and a Fire Break intervention for each sector.
 */
export function generateIsochroneCandidates(
  area: DemoArea,
  scenario: Scenario,
  currentArrival: Float32Array,
  baselineArrival: Float32Array,
  slopeDegGrid: Float32Array,
  unit: FireStationAsset,
  wave: 1 | 2,
  etaSeconds: number,
): CandidateArc[] {
  const { width, height, cellSizeM } = area.grid;
  const cellAreaHa = (cellSizeM * cellSizeM) / 10_000;
  const ign = scenario.ignition[0] ?? { row: Math.floor(height / 2), col: Math.floor(width / 2) };
  const windToward = windTowardDeg(scenario.weather.windFromDeg);

  const sectorBuckets: Map<string, { row: number; col: number; arrival: number }[]> = new Map();
  for (const s of COMPASS_SECTORS) sectorBuckets.set(s.code, []);

  const populateBuckets = (arrivalGrid: Float32Array, minTime: number) => {
    for (let r = 2; r < height - 2; r++) {
      for (let c = 2; c < width - 2; c++) {
        const idx = r * width + c;
        if (area.fuel[idx] === FuelClass.NONE) continue;
        const tArr = arrivalGrid[idx];
        if (tArr <= minTime || tArr === NEVER_ARRIVES) continue;

        const dRow = r - ign.row;
        const dCol = c - ign.col;
        if (dRow === 0 && dCol === 0) continue;

        // Bearing clockwise from North (row decreases north, col increases east)
        const bearing = ((Math.atan2(dCol, -dRow) * 180) / Math.PI + 360) % 360;
        let bestSector = COMPASS_SECTORS[0];
        let bestDiff = 360;
        for (const sec of COMPASS_SECTORS) {
          const diff = angularDiffDeg(bearing, sec.angleDeg);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestSector = sec;
          }
        }
        sectorBuckets.get(bestSector.code)!.push({ row: r, col: c, arrival: tArr });
      }
    }
  };

  populateBuckets(currentArrival, etaSeconds);

  const activeSectors = Array.from(sectorBuckets.values()).filter((b) => b.length >= 2).length;
  if (activeSectors < 3) {
    for (const s of COMPASS_SECTORS) {
      if (sectorBuckets.get(s.code)!.length < 2) {
        sectorBuckets.set(s.code, []);
      }
    }
    populateBuckets(baselineArrival, Math.min(etaSeconds, 120));
  }

  const candidates: CandidateArc[] = [];

  for (const sec of COMPASS_SECTORS) {
    const cells = sectorBuckets.get(sec.code)!;
    if (cells.length === 0) continue;

    cells.sort((a, b) => a.arrival - b.arrival);
    const anchor = cells[Math.min(cells.length - 1, Math.floor(cells.length * 0.08))];

    const dr = anchor.row - ign.row;
    const dc = anchor.col - ign.col;
    const len = Math.max(1, Math.hypot(dr, dc));
    const ur = dr / len;
    const uc = dc / len;

    const tr = -uc;
    const tc = ur;

    const centerRow = Math.max(3, Math.min(height - 4, Math.round(anchor.row + ur * 1.5)));
    const centerCol = Math.max(3, Math.min(width - 4, Math.round(anchor.col + uc * 1.5)));

    const halfSpan = Math.floor(unit.dropLengthCells / 2);
    const p1: [number, number] = [
      Math.max(1, Math.min(width - 2, Math.round(centerCol - tc * halfSpan))),
      Math.max(1, Math.min(height - 2, Math.round(centerRow - tr * halfSpan))),
    ];
    const pMid: [number, number] = [centerCol, centerRow];
    const p2: [number, number] = [
      Math.max(1, Math.min(width - 2, Math.round(centerCol + tc * halfSpan))),
      Math.max(1, Math.min(height - 2, Math.round(centerRow + tr * halfSpan))),
    ];

    const strokePoints: [number, number][] = [p1, pMid, p2];
    const id = `agent-${unit.id}-w${wave}-${sec.code}`;

    const waterIv = makeWater(area.grid, strokePoints as Pt[], unit.waterRadiusCells, etaSeconds, id, {
      moistureBoost: unit.moistureBoost,
      halfLifeS: unit.halfLifeS,
    });
    const fbWidth = Math.max(2, Math.min(3, unit.waterRadiusCells));
    const firebreakIv = makeFirebreak(area.grid, strokePoints as Pt[], fbWidth, etaSeconds, id);
    if (!waterIv || !firebreakIv) continue;

    // Inspect fuel classes, slope, road proximity, and deforestation impact across the swath cells
    let roadCellsNear = 0;
    let slopeSum = 0;
    const fuelCounts = new Map<number, number>();

    for (const cIdx of waterIv.cells) {
      const f = area.fuel[cIdx];
      if (f !== FuelClass.NONE) {
        fuelCounts.set(f, (fuelCounts.get(f) ?? 0) + 1);
      }
      slopeSum += slopeDegGrid[cIdx] ?? 0;

      const cr = Math.floor(cIdx / width);
      const cc = cIdx % width;
      for (let rr = -2; rr <= 2; rr += 2) {
        for (let rc = -2; rc <= 2; rc += 2) {
          const nr = cr + rr;
          const nc = cc + rc;
          if (nr >= 0 && nr < height && nc >= 0 && nc < width) {
            if (area.fuel[nr * width + nc] === FuelClass.NONE) roadCellsNear++;
          }
        }
      }
    }

    // Calculate deforestation cost (hectares of trees / woody canopy felled by firebreakIv)
    let forestCellsCut = 0;
    let shrubCellsCut = 0;
    for (const cIdx of firebreakIv.cells) {
      const f = area.fuel[cIdx];
      if (f === FuelClass.FOREST_DECIDUOUS || f === FuelClass.FOREST_CONIFER) {
        forestCellsCut++;
      } else if (f === FuelClass.SHRUB) {
        shrubCellsCut++;
      }
    }
    const deforestedHa = Number(
      Math.max(0.05, (forestCellsCut + shrubCellsCut * 0.25) * cellAreaHa).toFixed(2),
    );

    let dominantFuelClass: number = FuelClass.SHRUB;
    let maxFuelCount = -1;
    for (const [fClass, cnt] of fuelCounts.entries()) {
      if (cnt > maxFuelCount) {
        maxFuelCount = cnt;
        dominantFuelClass = fClass;
      }
    }
    const dominantFuelLabel = FUEL_LABELS[dominantFuelClass] ?? 'brush fuel';
    const meanSlopeDeg =
      waterIv.cells.length > 0 ? Number((slopeSum / waterIv.cells.length).toFixed(1)) : 8;

    const windDiff = angularDiffDeg(sec.angleDeg, windToward);
    const roleTag =
      windDiff <= 35 ? 'Head Fire' : windDiff <= 95 ? 'Windward Flank' : 'Rear/Slope Anchor';

    candidates.push({
      sectorCode: sec.code,
      sectorLabel: `${sec.code} ${roleTag}`,
      centerCell: { row: centerRow, col: centerCol },
      strokePoints,
      waterIntervention: {
        ...waterIv,
        label: `W${wave} ${unit.name} Water Spray (${sec.code} ${roleTag})`,
      },
      firebreakIntervention: {
        ...firebreakIv,
        label: `W${wave} ${unit.name} Fire Break (${sec.code} ${roleTag})`,
      },
      dominantFuelClass,
      dominantFuelLabel,
      meanSlopeDeg,
      roadProximityScore: roadCellsNear,
      forestCellsCut,
      deforestedHa,
    });
  }

  candidates.sort((a, b) => {
    const angleA = COMPASS_SECTORS.find((s) => s.code === a.sectorCode)?.angleDeg ?? 0;
    const angleB = COMPASS_SECTORS.find((s) => s.code === b.sectorCode)?.angleDeg ?? 0;
    const diffA = angularDiffDeg(angleA, windToward);
    const diffB = angularDiffDeg(angleB, windToward);
    return diffA - diffB;
  });

  return candidates.slice(0, 3);
}

/**
 * Runs the Fast Algorithmic Rollout Optimizer across Wave 1 (Initial Attack) and Wave 2 (Refill Drops).
 * Retrained Policy Objective:
 *   1. Minimize wildfire damage (maximize burned area reduction).
 *   2. Minimize deforestation: all units carry an average fire truck water payload (2,500 L) and travel at
 *      average fire truck speed (55 km/h transit, ~10.5 km/h active fireline pumping/cutting).
 *   3. Cutting down trees (`firebreak`) ONLY occurs when the consequence of NOT doing so (`water` spray)
 *      would lead to the fire spreading more by a margin exceeding the trees felled (`firebreakSavedHa - waterSavedHa > deforestedHa`).
 */
export function runCounterfactualRolloutOptimizer(
  area: DemoArea,
  baselineScenario: Scenario,
  baselineResult: SimResult,
  stations: FireStationAsset[],
  dipSite: DipSite | null,
  dispatchOffsetSeconds = 0,
): Omit<TacticalPlanResult, 'commanderBriefing' | 'briefingSource'> {
  const t0 = performance.now();
  const reasoningLog: ReasoningStep[] = [];
  const selectedOrders: AgentDispatchOrder[] = [];
  const lockedInterventions: Intervention[] = [...baselineScenario.interventions];

  const { slopeDeg } = computeSlopeAspect(
    area.elevation,
    area.grid.width,
    area.grid.height,
    area.grid.cellSizeM,
  );

  let currentResult = baselineResult;
  let currentBurnedHa = baselineResult.stats.burnedAreaHa;
  const baselineBurnedHa = baselineResult.stats.burnedAreaHa;
  let stepCounter = 1;

  interface WaveSlot {
    unit: FireStationAsset;
    unitIndex: number;
    wave: 1 | 2;
    dispatchTimeSeconds: number;
    etaSeconds: number;
    executionDurationSeconds: number;
    sourceType: 'station' | 'dip_site';
    sourceLonLat: { lon: number; lat: number };
  }

  const waveSlots: WaveSlot[] = [];
  const topUnits = stations.slice(0, 4);

  // Active fire-truck speed along the containment line while pumping 2,500L or cutting swath (~10.5 km/h = 2.92 m/s)
  const activeFireTruckLineSpeedMps = (10.5 * 1000) / 3600;

  topUnits.forEach((unit, unitIndex) => {
    const wave1Dispatch = Math.round(dispatchOffsetSeconds + unitIndex * 25);
    const wave1Eta = Math.round(dispatchOffsetSeconds + unit.travelTimeSeconds);
    const swathLengthM = unit.dropLengthCells * area.grid.cellSizeM;
    const execDuration = Math.max(90, Math.round(swathLengthM / activeFireTruckLineSpeedMps));

    if (wave1Eta < baselineScenario.durationSeconds * 0.85) {
      waveSlots.push({
        unit,
        unitIndex,
        wave: 1,
        dispatchTimeSeconds: Math.min(wave1Dispatch, Math.max(0, wave1Eta - 90)),
        etaSeconds: wave1Eta,
        executionDurationSeconds: execDuration,
        sourceType: 'station',
        sourceLonLat: { lon: unit.lon, lat: unit.lat },
      });
    }

    const turnaround =
      unit.unitType === 'helicopter' && dipSite
        ? dipSite.turnaroundSeconds
        : unit.turnaroundSeconds;
    const wave1Done = wave1Eta + execDuration;
    const wave2Eta = wave1Done + turnaround;
    const wave2Dispatch =
      unit.unitType === 'helicopter' && dipSite
        ? wave1Done + Math.max(60, Math.round(turnaround * 0.52))
        : wave1Done + 30;

    if (
      (unit.unitType === 'helicopter' || unit.unitType === 'engine') &&
      wave2Eta < baselineScenario.durationSeconds * 0.88
    ) {
      waveSlots.push({
        unit,
        unitIndex,
        wave: 2,
        dispatchTimeSeconds: Math.min(wave2Dispatch, wave2Eta - 45),
        etaSeconds: wave2Eta,
        executionDurationSeconds: execDuration,
        sourceType: unit.unitType === 'helicopter' && dipSite ? 'dip_site' : 'station',
        sourceLonLat:
          unit.unitType === 'helicopter' && dipSite
            ? { lon: dipSite.lon, lat: dipSite.lat }
            : { lon: unit.lon, lat: unit.lat },
      });
    }
  });

  waveSlots.sort((a, b) => a.etaSeconds - b.etaSeconds);

  for (const slot of waveSlots) {
    const candidates = generateIsochroneCandidates(
      area,
      baselineScenario,
      currentResult.arrivalTime,
      baselineResult.arrivalTime,
      slopeDeg,
      slot.unit,
      slot.wave,
      slot.etaSeconds,
    );

    if (candidates.length === 0) continue;

    interface EvaluatedCandidate {
      cand: CandidateArc;
      waterRes: SimResult;
      firebreakRes: SimResult;
      waterSavedHa: number;
      firebreakSavedHa: number;
      uncontainedSpreadIfNoFirebreakHa: number;
      chosenTactic: TacticType;
      chosenIntervention: Intervention;
      chosenRes: SimResult;
      chosenSavedHa: number;
      tacticRationale: string;
      score: number;
    }

    let bestEval: EvaluatedCandidate | null = null;
    const trialSteps: { step: ReasoningStep; sectorLabel: string; tactic: TacticType }[] = [];
    const unitWaterLiters = slot.unit.waterCapacityLiters ?? 2500;

    for (const cand of candidates) {
      // 1. Simulate Water Spray Counterfactual (2,500 L fire truck water drop, 0 ha deforestation)
      const waterScenario: Scenario = {
        ...baselineScenario,
        interventions: [...lockedInterventions, cand.waterIntervention],
      };
      const waterRes = simulate(waterScenario);
      const waterSavedHa = Number(
        Math.max(0, currentBurnedHa - waterRes.stats.burnedAreaHa).toFixed(2),
      );

      // 2. Simulate Fire Break Counterfactual (clears cand.deforestedHa of trees/canopy)
      const fbScenario: Scenario = {
        ...baselineScenario,
        interventions: [...lockedInterventions, cand.firebreakIntervention],
      };
      const firebreakRes = simulate(fbScenario);
      const firebreakSavedHa = Number(
        Math.max(0, currentBurnedHa - firebreakRes.stats.burnedAreaHa).toFixed(2),
      );

      // Consequence of NOT cutting down trees: how many additional hectares the fire would spread
      // if we rely on the 2,500 L water spray instead of cutting a firebreak.
      const uncontainedSpreadIfNoFirebreakHa = Number(
        Math.max(0, firebreakSavedHa - waterSavedHa).toFixed(2),
      );

      // Retrained Conservation Policy:
      // Cutting down trees (`firebreak`) MUST ONLY occur when the consequence of not doing so
      // would lead to the fire spreading more than the deforestation cost (`uncontainedSpreadIfNoFirebreakHa > cand.deforestedHa`).
      // Otherwise, the agent MUST use `water` spray (0 ha deforestation).
      const minSpreadReductionAdvantageHa = Math.max(0.15, cand.deforestedHa);
      let chosenTactic: TacticType;
      let tacticRationale: string;

      if (uncontainedSpreadIfNoFirebreakHa > minSpreadReductionAdvantageHa) {
        chosenTactic = 'firebreak';
        tacticRationale = `Cutting ${cand.deforestedHa.toFixed(2)} ha of ${cand.dominantFuelLabel} prevents +${uncontainedSpreadIfNoFirebreakHa.toFixed(1)} ha of breakaway fire spread (-${firebreakSavedHa.toFixed(1)} ha vs ${unitWaterLiters}L Water -${waterSavedHa.toFixed(1)} ha).`;
      } else {
        chosenTactic = 'water';
        tacticRationale = `${unitWaterLiters}L fire-truck water spray holds ${cand.dominantFuelLabel} (-${waterSavedHa.toFixed(1)} ha) with 0 ha deforestation (spares ${cand.deforestedHa.toFixed(2)} ha of trees; firebreak -${firebreakSavedHa.toFixed(1)} ha).`;
      }

      const chosenIntervention =
        chosenTactic === 'firebreak' ? cand.firebreakIntervention : cand.waterIntervention;
      const chosenRes = chosenTactic === 'firebreak' ? firebreakRes : waterRes;
      const chosenSavedHa = chosenTactic === 'firebreak' ? firebreakSavedHa : waterSavedHa;

      const waterStep: ReasoningStep = {
        stepIndex: stepCounter++,
        phase: 'rollout',
        unitName: slot.unit.name,
        wave: slot.wave,
        testedTactic: 'water',
        sectorLabel: cand.sectorLabel,
        etaSeconds: slot.etaSeconds,
        candidateCellsCount: cand.waterIntervention.cells.length,
        projectedBurnedHa: Number(waterRes.stats.burnedAreaHa.toFixed(2)),
        marginalSavedHa: waterSavedHa,
        selected: false,
        summary: `Tested W${slot.wave} ${slot.unit.name} [${unitWaterLiters}L WATER SPRAY · 0 ha cut] at ${cand.sectorLabel} → -${waterSavedHa.toFixed(1)} ha (${cand.dominantFuelLabel})`,
      };
      const fbStep: ReasoningStep = {
        stepIndex: stepCounter++,
        phase: 'rollout',
        unitName: slot.unit.name,
        wave: slot.wave,
        testedTactic: 'firebreak',
        sectorLabel: cand.sectorLabel,
        etaSeconds: slot.etaSeconds,
        candidateCellsCount: cand.firebreakIntervention.cells.length,
        projectedBurnedHa: Number(firebreakRes.stats.burnedAreaHa.toFixed(2)),
        marginalSavedHa: firebreakSavedHa,
        selected: false,
        summary: `Tested W${slot.wave} ${slot.unit.name} [FIRE BREAK · ${cand.deforestedHa.toFixed(2)} ha trees cut] at ${cand.sectorLabel} → -${firebreakSavedHa.toFixed(1)} ha (${cand.dominantFuelLabel})`,
      };

      reasoningLog.push(waterStep, fbStep);
      trialSteps.push(
        { step: waterStep, sectorLabel: cand.sectorLabel, tactic: 'water' },
        { step: fbStep, sectorLabel: cand.sectorLabel, tactic: 'firebreak' },
      );

      // Multi-objective reward: maximize area saved while penalizing deforestation
      const netEcologicalSavedHa =
        chosenTactic === 'firebreak'
          ? chosenSavedHa - cand.deforestedHa * 1.25
          : chosenSavedHa;
      const score =
        netEcologicalSavedHa +
        (chosenTactic === 'water' ? 0.12 : 0) +
        (slot.unit.unitType === 'engine' ? cand.roadProximityScore * 0.01 : 0);

      if (!bestEval || score > bestEval.score) {
        bestEval = {
          cand,
          waterRes,
          firebreakRes,
          waterSavedHa,
          firebreakSavedHa,
          uncontainedSpreadIfNoFirebreakHa,
          chosenTactic,
          chosenIntervention,
          chosenRes,
          chosenSavedHa,
          tacticRationale,
          score,
        };
      }
    }

    if (bestEval) {
      const winningTrial = trialSteps.find(
        (t) =>
          t.sectorLabel === bestEval!.cand.sectorLabel && t.tactic === bestEval!.chosenTactic,
      );
      if (winningTrial) {
        winningTrial.step.selected = true;
        const ecoNote =
          bestEval.chosenTactic === 'firebreak'
            ? `Cut ${bestEval.cand.deforestedHa.toFixed(2)} ha to stop +${bestEval.uncontainedSpreadIfNoFirebreakHa.toFixed(1)} ha spread`
            : `0 ha deforestation (${unitWaterLiters}L water)`;
        winningTrial.step.summary = `✓ Selected W${slot.wave} ${slot.unit.name} [${bestEval.chosenTactic === 'firebreak' ? 'FIRE BREAK' : 'WATER SPRAY'}] at ${bestEval.cand.sectorLabel} (t+${Math.round(slot.etaSeconds / 60)}m) · Saved ${bestEval.chosenSavedHa.toFixed(1)} ha · ${ecoNote}`;
      }

      lockedInterventions.push(bestEval.chosenIntervention);
      currentResult = bestEval.chosenRes;
      currentBurnedHa = bestEval.chosenRes.stats.burnedAreaHa;

      const dropCenterLonLat = cellCenterLonLat(
        area.grid,
        bestEval.cand.centerCell.row,
        bestEval.cand.centerCell.col,
      );

      const firstStrokePt = bestEval.cand.strokePoints[0] ?? [
        bestEval.cand.centerCell.col,
        bestEval.cand.centerCell.row,
      ];
      const arcStartLonLat = cellCenterLonLat(area.grid, firstStrokePt[1], firstStrokePt[0]);

      const originLonLat =
        slot.sourceType === 'dip_site'
          ? slot.sourceLonLat
          : slot.unit.entryLonLat;

      const routeWaypointsLonLat: [number, number][] =
        slot.unit.unitType === 'engine'
          ? buildCurvedRoadWaypoints(
              originLonLat.lon,
              originLonLat.lat,
              arcStartLonLat.lon,
              arcStartLonLat.lat,
              10,
            )
          : [
              [originLonLat.lon, originLonLat.lat],
              [arcStartLonLat.lon, arcStartLonLat.lat],
            ];

      const crewPersona =
        slot.unit.crewPersona ??
        assignStationCrewPersona(slot.unit.id, slot.unit.name, slot.unit.unitType, slot.unitIndex);

      const tacticComparison: TacticComparisonMetrics = {
        waterSavedHa: bestEval.waterSavedHa,
        firebreakSavedHa: bestEval.firebreakSavedHa,
        deforestedHa: bestEval.chosenTactic === 'firebreak' ? bestEval.cand.deforestedHa : 0,
        uncontainedSpreadIfNoFirebreakHa: bestEval.uncontainedSpreadIfNoFirebreakHa,
        waterDropLiters: unitWaterLiters,
        selectedTactic: bestEval.chosenTactic,
        dominantFuelClass: bestEval.cand.dominantFuelClass,
        dominantFuelLabel: bestEval.cand.dominantFuelLabel,
        meanSlopeDeg: bestEval.cand.meanSlopeDeg,
        tacticRationale: bestEval.tacticRationale,
      };

      const radioCallouts = buildOrderRadioCallouts(
        bestEval.chosenIntervention.id,
        slot.unit,
        crewPersona,
        slot.wave,
        slot.sourceType,
        bestEval.chosenTactic,
        bestEval.cand.sectorLabel,
        bestEval.cand.dominantFuelLabel,
        slot.dispatchTimeSeconds,
        slot.etaSeconds,
        slot.executionDurationSeconds,
        originLonLat,
        dropCenterLonLat,
        dipSite,
      );

      selectedOrders.push({
        id: bestEval.chosenIntervention.id,
        unit: slot.unit,
        wave: slot.wave,
        sourceType: slot.sourceType,
        sourceLonLat: originLonLat,
        dropCenterCell: bestEval.cand.centerCell,
        dropCenterLonLat,
        strokePoints: bestEval.cand.strokePoints,
        tacticType: bestEval.chosenTactic,
        tacticComparison,
        crewPersona,
        intervention: bestEval.chosenIntervention,
        dispatchTimeSeconds: slot.dispatchTimeSeconds,
        etaSeconds: slot.etaSeconds,
        executionDurationSeconds: slot.executionDurationSeconds,
        routeWaypointsLonLat,
        radioCallouts,
        sectorLabel: bestEval.cand.sectorLabel,
        marginalSavedHa: Number(bestEval.chosenSavedHa.toFixed(2)),
        rationale: bestEval.tacticRationale,
        enabled: true,
      });
    }
  }

  const projectedBurnedHa = Number(currentBurnedHa.toFixed(2));
  const savedHa = Number(Math.max(0, baselineBurnedHa - projectedBurnedHa).toFixed(2));
  const reductionPct =
    baselineBurnedHa > 0 ? Number(((savedHa / baselineBurnedHa) * 100).toFixed(1)) : 0;

  const totalDeforestedHa = Number(
    selectedOrders
      .reduce((acc, o) => acc + (o.tacticType === 'firebreak' ? o.tacticComparison.deforestedHa : 0), 0)
      .toFixed(2),
  );
  const totalWaterDroppedLiters = selectedOrders.reduce(
    (acc, o) => acc + (o.tacticType === 'water' ? o.tacticComparison.waterDropLiters : 0),
    0,
  );

  return {
    orders: selectedOrders,
    dipSite,
    reasoningLog,
    baselineBurnedHa: Number(baselineBurnedHa.toFixed(2)),
    projectedBurnedHa,
    savedHa,
    reductionPct,
    totalDeforestedHa,
    totalWaterDroppedLiters,
    computedInMs: Math.round(performance.now() - t0),
  };
}

/**
 * Kinematic state of a single dispatch order at simulated time `currentTimeS`.
 * Used by both the 3D Cesium globe overlay and unit tests.
 */
export interface OrderKinematicState {
  orderId: string;
  phase: 'standby' | 'transit' | 'executing_tactic' | 'dip_refill' | 'completed';
  visible: boolean;
  lon: number;
  lat: number;
  altitudeM: number;
  /** Fraction (0..1) of the transit route completed. */
  transitProgress: number;
  /** Fraction (0..1) of the water spray or firebreak swath drawn on the terrain. */
  swathProgress: number;
  /** Interpolated lon/lat polyline of the progressively drawn swath up to `currentTimeS`. */
  activeSwathLonLats: [number, number][];
  statusBadge: string;
}

function interpolatePolyline(waypoints: [number, number][], u: number): [number, number] {
  if (waypoints.length === 0) return [0, 0];
  if (waypoints.length === 1 || u <= 0) return waypoints[0];
  if (u >= 1) return waypoints[waypoints.length - 1];
  const scaled = u * (waypoints.length - 1);
  const idx = Math.min(waypoints.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  const [lon1, lat1] = waypoints[idx];
  const [lon2, lat2] = waypoints[idx + 1];
  return [lon1 + (lon2 - lon1) * frac, lat1 + (lat2 - lat1) * frac];
}

/**
 * Computes the exact 3D position, flight/road altitude, phase, and progressive swath polyline
 * for an `AgentDispatchOrder` at `currentTimeS`.
 */
export function computeOrderKinematicsAtTime(
  order: AgentDispatchOrder,
  allOrders: AgentDispatchOrder[],
  dipSite: DipSite | null,
  grid: GridSpec,
  currentTimeS: number,
): OrderKinematicState {
  const strokeLonLats: [number, number][] = [];
  if (order.strokePoints.length >= 2) {
    // Densify strokePoints into 16 smooth points so progressive swath drawing is fluid
    const rawPts = order.strokePoints.map(([col, row]) => {
      const pt = cellCenterLonLat(grid, row, col);
      return [pt.lon, pt.lat] as [number, number];
    });
    for (let i = 0; i <= 16; i++) {
      strokeLonLats.push(interpolatePolyline(rawPts, i / 16));
    }
  }

  const endExecTime = order.etaSeconds + order.executionDurationSeconds;
  const cruiseAlt =
    order.unit.unitType === 'engine'
      ? 14
      : order.unit.unitType === 'helicopter'
        ? order.wave === 2
          ? 165
          : 230
        : 380;

  // Check if this is a Wave 2 helicopter order that is currently in the Dip-Site Shuttle Refill window
  if (order.wave === 2 && order.sourceType === 'dip_site' && dipSite) {
    const wave1Order = allOrders.find(
      (o) => o.unit.id === order.unit.id && o.wave === 1 && o.enabled,
    );
    const wave1End = wave1Order
      ? wave1Order.etaSeconds + wave1Order.executionDurationSeconds
      : Math.max(0, order.dispatchTimeSeconds - 120);

    if (currentTimeS > wave1End && currentTimeS < order.dispatchTimeSeconds) {
      const shuttleSpan = Math.max(1, order.dispatchTimeSeconds - wave1End);
      const u = Math.max(0, Math.min(1, (currentTimeS - wave1End) / shuttleSpan));
      const wave1LastCell = wave1Order?.strokePoints[wave1Order.strokePoints.length - 1];
      const startPt = wave1LastCell
        ? cellCenterLonLat(grid, wave1LastCell[1], wave1LastCell[0])
        : order.dropCenterLonLat;
      // First 70% of window: fly from Wave 1 end to DipSite; last 30%: hover & dip at DipSite
      const flyU = Math.min(1, u / 0.7);
      const lon = startPt.lon + (dipSite.lon - startPt.lon) * flyU;
      const lat = startPt.lat + (dipSite.lat - startPt.lat) * flyU;
      const alt = u < 0.7 ? 35 + Math.sin(flyU * Math.PI) * 140 : 18;
      return {
        orderId: order.id,
        phase: 'dip_refill',
        visible: true,
        lon,
        lat,
        altitudeM: alt,
        transitProgress: u,
        swathProgress: 0,
        activeSwathLonLats: [],
        statusBadge: u < 0.7 ? 'SHUTTLE TO DIP SITE' : 'DIPPING WATER BUCKET',
      };
    }
  }

  // Phase 1: Standby prior to dispatch
  if (currentTimeS < order.dispatchTimeSeconds) {
    const [startLon, startLat] = order.routeWaypointsLonLat[0] ?? [
      order.sourceLonLat.lon,
      order.sourceLonLat.lat,
    ];
    return {
      orderId: order.id,
      phase: 'standby',
      visible: order.wave === 1,
      lon: startLon,
      lat: startLat,
      altitudeM: 12,
      transitProgress: 0,
      swathProgress: 0,
      activeSwathLonLats: [],
      statusBadge: 'STANDBY',
    };
  }

  // Phase 2: Transit along road or flight arc (dispatchTimeSeconds <= t < etaSeconds)
  if (currentTimeS < order.etaSeconds) {
    const span = Math.max(1, order.etaSeconds - order.dispatchTimeSeconds);
    const u = Math.max(0, Math.min(1, (currentTimeS - order.dispatchTimeSeconds) / span));
    const [lon, lat] = interpolatePolyline(order.routeWaypointsLonLat, u);
    const alt =
      order.unit.unitType === 'engine' ? 14 : 25 + Math.sin(u * Math.PI) * cruiseAlt;
    return {
      orderId: order.id,
      phase: 'transit',
      visible: true,
      lon,
      lat,
      altitudeM: alt,
      transitProgress: u,
      swathProgress: 0,
      activeSwathLonLats: [],
      statusBadge: `EN ROUTE (${Math.round(u * 100)}%)`,
    };
  }

  // Phase 3: Active Tactic Execution along strokePoints (etaSeconds <= t <= endExecTime)
  if (currentTimeS <= endExecTime) {
    const span = Math.max(1, order.executionDurationSeconds);
    const p = Math.max(0, Math.min(1, (currentTimeS - order.etaSeconds) / span));
    const [lon, lat] = interpolatePolyline(strokeLonLats, p);
    const count = Math.max(2, Math.ceil(p * strokeLonLats.length));
    const activeSwath = strokeLonLats.slice(0, count);
    if (activeSwath.length >= 2) {
      activeSwath[activeSwath.length - 1] = [lon, lat];
    }
    const execAlt =
      order.unit.unitType === 'engine'
        ? 14
        : order.unit.unitType === 'helicopter'
          ? 55
          : 95;
    return {
      orderId: order.id,
      phase: 'executing_tactic',
      visible: true,
      lon,
      lat,
      altitudeM: execAlt,
      transitProgress: 1,
      swathProgress: p,
      activeSwathLonLats: activeSwath,
      statusBadge:
        order.tacticType === 'firebreak'
          ? `CUTTING FIRE BREAK (${Math.round(p * 100)}%)`
          : `SPRAYING WATER (${Math.round(p * 100)}%)`,
    };
  }

  // Phase 4: Completed drop/firebreak
  const [endLon, endLat] = strokeLonLats[strokeLonLats.length - 1] ?? [
    order.dropCenterLonLat.lon,
    order.dropCenterLonLat.lat,
  ];
  // Hide Wave 1 helicopter icon once its Wave 2 shuttle takes over
  const hasActiveWave2 =
    order.wave === 1 &&
    allOrders.some(
      (o) => o.unit.id === order.unit.id && o.wave === 2 && o.enabled && currentTimeS > endExecTime,
    );

  return {
    orderId: order.id,
    phase: 'completed',
    visible: !hasActiveWave2,
    lon: endLon,
    lat: endLat,
    altitudeM: order.unit.unitType === 'engine' ? 14 : 45,
    transitProgress: 1,
    swathProgress: 1,
    activeSwathLonLats: strokeLonLats,
    statusBadge:
      order.tacticType === 'firebreak' ? 'FIRE BREAK COMPLETE' : 'WATER DROP COMPLETE',
  };
}
