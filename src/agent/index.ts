/**
 * Tactical Dispatch Agent Orchestrator:
 * Combines Agent 1 (Logistics/OSRM/DipSite/CrewPersonas), Agent 2 (Hybrid Counterfactual Tactic Optimizer),
 * and Agent 3 (Server-Side Tactic & Radio Script Agent).
 */

import { windTowardDeg } from '../contract';
import type { Scenario, SimResult } from '../contract';
import type { DemoArea } from '../data/bundle';
import type { Pt } from '../data/raster';
import { buildFallbackBriefing } from '../server/tacticalBriefingHandler';
import { makeFirebreak } from '../tools/firebreak';
import { makeWater } from '../tools/water';
import { runCounterfactualRolloutOptimizer } from './optimizer';
import type {
  DipSite,
  FireStationAsset,
  TacticalBriefingRequest,
  TacticalBriefingResponse,
  TacticalPlanResult,
} from './types';

export * from './types';
export * from './logistics';
export * from './optimizer';

export async function generateTacticalContainmentPlan(
  area: DemoArea,
  scenario: Scenario,
  baselineResult: SimResult,
  stations: FireStationAsset[],
  dipSite: DipSite | null,
  dispatchOffsetSeconds = 0,
): Promise<TacticalPlanResult> {
  const rollout = runCounterfactualRolloutOptimizer(
    area,
    scenario,
    baselineResult,
    stations,
    dipSite,
    dispatchOffsetSeconds,
  );

  const briefingReq: TacticalBriefingRequest = {
    areaLabel: area.meta.label,
    windSpeedKmh: Number((scenario.weather.windSpeedMps * 3.6).toFixed(1)),
    windTowardDeg: windTowardDeg(scenario.weather.windFromDeg),
    temperatureC: scenario.weather.temperatureC,
    relativeHumidityPct: Math.round(scenario.weather.relativeHumidity * 100),
    baselineBurnedHa: rollout.baselineBurnedHa,
    projectedBurnedHa: rollout.projectedBurnedHa,
    savedHa: rollout.savedHa,
    reductionPct: rollout.reductionPct,
    totalDeforestedHa: rollout.totalDeforestedHa,
    totalWaterDroppedLiters: rollout.totalWaterDroppedLiters,
    dipSiteLabel: dipSite ? dipSite.label : null,
    orders: rollout.orders.map((o) => ({
      id: o.id,
      unitName: o.unit.name,
      unitType: o.unit.unitType,
      wave: o.wave,
      sourceType: o.sourceType,
      etaMinutes: Math.max(1, Math.round((o.etaSeconds - o.dispatchTimeSeconds) / 60)),
      sectorLabel: o.sectorLabel,
      cellsCount: o.intervention.cells.length,
      marginalSavedHa: o.marginalSavedHa,
      tacticType: o.tacticType,
      waterSavedHa: o.tacticComparison.waterSavedHa,
      firebreakSavedHa: o.tacticComparison.firebreakSavedHa,
      deforestedHa: o.tacticComparison.deforestedHa,
      waterDropLiters: o.tacticComparison.waterDropLiters,
      dominantFuelLabel: o.tacticComparison.dominantFuelLabel,
      meanSlopeDeg: o.tacticComparison.meanSlopeDeg,
      crewLeadName: o.crewPersona.crewLeadName,
      stationCallLabel: o.crewPersona.stationCallLabel,
      callsign: o.crewPersona.callsign,
      voicePreset: o.crewPersona.voicePreset,
    })),
  };

  let briefingRes: TacticalBriefingResponse = buildFallbackBriefing(briefingReq);

  if (typeof fetch !== 'undefined' && rollout.orders.length > 0) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch('/api/tactical-briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(briefingReq),
        signal: ctrl.signal,
      });
      if (res.ok) {
        const json = (await res.json()) as TacticalBriefingResponse;
        if (json && typeof json.commanderBriefing === 'string') {
          briefingRes = json;
        }
      }
    } catch {
      // Use deterministic fallback briefing when offline or in unit tests
    } finally {
      clearTimeout(timer);
    }
  }

  const itemMap = new Map(briefingRes.orderRationales.map((item) => [item.id, item]));

  const enrichedOrders = rollout.orders.map((o) => {
    const aiItem = itemMap.get(o.id);
    if (!aiItem) return o;

    // Strict Conservation Guardrail: never allow an external/LLM response to cut trees ('firebreak')
    // unless the counterfactual simulation proved that not cutting trees causes more wildfire spread
    // than the deforestation cost (o.tacticType === 'firebreak').
    const finalTactic =
      aiItem.selectedTactic === 'firebreak' && o.tacticType === 'firebreak'
        ? 'firebreak'
        : o.tacticType;

    let intervention = o.intervention;
    if (finalTactic !== o.tacticType) {
      if (finalTactic === 'firebreak') {
        const fbWidth = Math.max(2, Math.min(3, o.unit.waterRadiusCells));
        const fb = makeFirebreak(area.grid, o.strokePoints as Pt[], fbWidth, o.etaSeconds, o.id);
        if (fb) intervention = { ...fb, label: `W${o.wave} ${o.unit.name} Fire Break (${o.sectorLabel})` };
      } else {
        const w = makeWater(area.grid, o.strokePoints as Pt[], o.unit.waterRadiusCells, o.etaSeconds, o.id, {
          moistureBoost: o.unit.moistureBoost,
          halfLifeS: o.unit.halfLifeS,
        });
        if (w) intervention = { ...w, label: `W${o.wave} ${o.unit.name} Water Spray (${o.sectorLabel})` };
      }
    }

    const mandatoryPrefix = `This is ${o.crewPersona.crewLeadName} calling from ${o.crewPersona.stationCallLabel}`;
    const updatedCallouts = o.radioCallouts.map((c) => {
      if (c.phase === 'dispatch' && aiItem.dispatchTranscript) {
        const raw = aiItem.dispatchTranscript.trim();
        const transcript = raw.toLowerCase().startsWith('this is ')
          ? raw
          : `${mandatoryPrefix} — ${raw}`;
        return { ...c, tacticType: finalTactic, transcript };
      }
      if (c.phase === 'executing_tactic' && aiItem.executingTranscript) {
        return { ...c, tacticType: finalTactic, transcript: aiItem.executingTranscript.trim() };
      }
      if (c.phase === 'dip_refill' && aiItem.refillTranscript) {
        return { ...c, tacticType: finalTactic, transcript: aiItem.refillTranscript.trim() };
      }
      return { ...c, tacticType: finalTactic };
    });

    return {
      ...o,
      tacticType: finalTactic,
      intervention,
      tacticComparison: {
        ...o.tacticComparison,
        selectedTactic: finalTactic,
        tacticRationale: aiItem.tacticRationale ?? aiItem.rationale ?? o.tacticComparison.tacticRationale,
      },
      radioCallouts: updatedCallouts,
      rationale: aiItem.rationale || o.rationale,
    };
  });

  return {
    ...rollout,
    orders: enrichedOrders,
    commanderBriefing: briefingRes.commanderBriefing,
    briefingSource: briefingRes.source,
  };
}
