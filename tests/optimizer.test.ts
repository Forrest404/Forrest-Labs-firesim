import { describe, expect, it } from 'vitest';
import { discoverFireStations, findBestDipSite } from '../src/agent/logistics';
import {
  computeOrderKinematicsAtTime,
  runCounterfactualRolloutOptimizer,
} from '../src/agent/optimizer';
import { scenarioFromArea } from '../src/data/bundle';
import { defaultIgnition } from '../src/data/ignition';
import { makeSyntheticArea } from '../src/data/synthetic';
import { buildFallbackBriefing } from '../src/server/tacticalBriefingHandler';
import { simulate } from '../src/sim';

describe('Agent 2, 3 & 4 — Hybrid Tactic Selection (Water vs Firebreak), Clipped Radio Personas & 3D Kinematics', () => {
  it('evaluates both Water Spray and Fire Break counterfactuals, assigns station crew personas & opening callouts, and interpolates 3D unit kinematics', async () => {
    const area = makeSyntheticArea({
      name: 'boulder-creek',
      label: 'Boulder Creek, CA (synthetic)',
      centerLon: -122.122,
      centerLat: 37.126,
      seed: 101,
      style: 'valley',
    });
    const ignition = defaultIgnition(area) ?? { row: 100, col: 100 };
    const scenario = scenarioFromArea(area, {
      ignition: [ignition],
      durationSeconds: 3 * 3600,
    });
    const baselineResult = simulate(scenario);
    expect(baselineResult.stats.burnedCells).toBeGreaterThan(100);

    const stations = await discoverFireStations(area, { enableNetwork: false });
    const dipSite = findBestDipSite(area, ignition);

    const plan = runCounterfactualRolloutOptimizer(
      area,
      scenario,
      baselineResult,
      stations,
      dipSite,
      0,
    );

    // Must evaluate both water and firebreak rollouts and log them
    expect(plan.reasoningLog.length).toBeGreaterThanOrEqual(24);
    expect(plan.reasoningLog.some((r) => r.testedTactic === 'water')).toBe(true);
    expect(plan.reasoningLog.some((r) => r.testedTactic === 'firebreak')).toBe(true);
    expect(plan.orders.length).toBeGreaterThanOrEqual(3);

    // Must include both Wave 1 (Initial Attack) and Wave 2 (Refill Drop) orders
    expect(plan.orders.some((o) => o.wave === 1)).toBe(true);
    expect(plan.orders.some((o) => o.wave === 2)).toBe(true);

    // Retrained Conservation & Fire-Truck Calibration Policy:
    // 1. Every unit moves at average fire truck speed (55 km/h) and carries 2,500 L water capacity.
    // 2. Cutting down trees ('firebreak') ONLY occurs when the consequence of not doing so ('water')
    //    would lead to the fire spreading more than the trees felled (firebreakSavedHa - waterSavedHa > deforestedHa).
    expect(plan.orders.some((o) => o.tacticType === 'water')).toBe(true);
    for (const order of plan.orders) {
      expect(order.unit.speedKmh).toBe(55);
      expect(order.unit.waterCapacityLiters).toBe(2500);
      expect(order.tacticComparison.waterDropLiters).toBe(2500);

      if (order.tacticType === 'firebreak') {
        expect(order.tacticComparison.uncontainedSpreadIfNoFirebreakHa).toBeGreaterThan(
          order.tacticComparison.deforestedHa,
        );
        expect(order.tacticComparison.firebreakSavedHa).toBeGreaterThan(
          order.tacticComparison.waterSavedHa,
        );
      } else {
        expect(order.tacticComparison.deforestedHa).toBe(0);
      }

      expect(order.crewPersona.crewLeadName.length).toBeGreaterThan(3);
      expect(order.crewPersona.stationCallLabel).toMatch(/^Station \d+/);
      expect(['Kore', 'Fenrir', 'Puck', 'Charon']).toContain(order.crewPersona.voicePreset);
      expect(order.tacticComparison.dominantFuelLabel.length).toBeGreaterThan(2);

      const dispatchCallout = order.radioCallouts.find((c) => c.phase === 'dispatch');
      expect(dispatchCallout).toBeDefined();
      expect(
        dispatchCallout!.transcript.startsWith(
          `This is ${order.crewPersona.crewLeadName} calling from ${order.crewPersona.stationCallLabel}`,
        ),
      ).toBe(true);
    }

    // Helicopter Wave 2 must originate from the on-grid river/lake DipSite and include a dip_refill callout
    const heliWave2 = plan.orders.find((o) => o.unit.unitType === 'helicopter' && o.wave === 2);
    expect(heliWave2).toBeDefined();
    expect(heliWave2!.sourceType).toBe('dip_site');
    expect(heliWave2!.radioCallouts.some((c) => c.phase === 'dip_refill')).toBe(true);

    // Verify 3-phase kinematic interpolation (transit -> progressive swath execution -> completed)
    const sampleOrder = plan.orders[0];
    const midTransitT = Math.round((sampleOrder.dispatchTimeSeconds + sampleOrder.etaSeconds) / 2);
    const kinTransit = computeOrderKinematicsAtTime(sampleOrder, plan.orders, dipSite, area.grid, midTransitT);
    expect(kinTransit.phase).toBe('transit');
    expect(kinTransit.transitProgress).toBeGreaterThan(0);
    expect(kinTransit.transitProgress).toBeLessThan(1);
    expect(kinTransit.activeSwathLonLats.length).toBe(0);

    const midExecT = sampleOrder.etaSeconds + Math.round(sampleOrder.executionDurationSeconds * 0.5);
    const kinExec = computeOrderKinematicsAtTime(sampleOrder, plan.orders, dipSite, area.grid, midExecT);
    expect(kinExec.phase).toBe('executing_tactic');
    expect(kinExec.swathProgress).toBeGreaterThan(0.2);
    expect(kinExec.swathProgress).toBeLessThan(0.9);
    expect(kinExec.activeSwathLonLats.length).toBeGreaterThanOrEqual(2);

    const doneT = sampleOrder.etaSeconds + sampleOrder.executionDurationSeconds + 10;
    const kinDone = computeOrderKinematicsAtTime(sampleOrder, plan.orders, dipSite, area.grid, doneT);
    expect(kinDone.phase).toBe('completed');
    expect(kinDone.swathProgress).toBe(1);

    // Verify Helicopter Dip-Site Shuttle phase between Wave 1 completion and Wave 2 dispatch
    const heliWave1 = plan.orders.find((o) => o.unit.id === heliWave2!.unit.id && o.wave === 1);
    if (heliWave1 && heliWave2) {
      const w1End = heliWave1.etaSeconds + heliWave1.executionDurationSeconds;
      const shuttleMidT = Math.round((w1End + heliWave2.dispatchTimeSeconds) / 2);
      const kinShuttle = computeOrderKinematicsAtTime(heliWave2, plan.orders, dipSite, area.grid, shuttleMidT);
      expect(kinShuttle.phase).toBe('dip_refill');
      expect(kinShuttle.visible).toBe(true);
    }

    // Counterfactual verification: projected burned area must be strictly less than baseline
    expect(plan.projectedBurnedHa).toBeLessThan(plan.baselineBurnedHa);
    expect(plan.savedHa).toBeGreaterThan(0);
    expect(plan.reductionPct).toBeGreaterThan(0);

    // Agent 3 verification: deterministic fallback briefing synthesis & clipped radio scripts
    const briefing = buildFallbackBriefing({
      areaLabel: area.meta.label,
      windSpeedKmh: Number((scenario.weather.windSpeedMps * 3.6).toFixed(1)),
      windTowardDeg: (scenario.weather.windFromDeg + 180) % 360,
      temperatureC: scenario.weather.temperatureC,
      relativeHumidityPct: Math.round(scenario.weather.relativeHumidity * 100),
      baselineBurnedHa: plan.baselineBurnedHa,
      projectedBurnedHa: plan.projectedBurnedHa,
      savedHa: plan.savedHa,
      reductionPct: plan.reductionPct,
      totalDeforestedHa: plan.totalDeforestedHa,
      totalWaterDroppedLiters: plan.totalWaterDroppedLiters,
      dipSiteLabel: dipSite?.label ?? null,
      orders: plan.orders.map((o) => ({
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
    });

    expect(briefing.commanderBriefing.length).toBeGreaterThan(20);
    expect(briefing.orderRationales.length).toBe(plan.orders.length);
    for (const item of briefing.orderRationales) {
      expect(item.dispatchTranscript).toMatch(/^This is .+ calling from Station \d+/);
    }
  });
});
