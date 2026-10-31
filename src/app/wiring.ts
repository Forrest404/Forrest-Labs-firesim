/**
 * Glue between the store, the Cesium viewer and the simulation worker. The only place where
 * viewer objects are created in response to state changes.
 */

import {
  discoverFireStations,
  findBestDipSite,
  generateTacticalContainmentPlan,
} from '../agent';
import { FuelClass, validateScenario, windTowardDeg } from '../contract';
import type { Scenario } from '../contract';
import { scenarioFromArea } from '../data/bundle';
import { loadDemoArea } from '../data/demoAreas';
import { defaultIgnition } from '../data/ignition';
import { computeSlopeAspect } from '../data/terrain';
import { paintFuel, paintSlope } from '../viewer/burnCanvas';
import { GridLayer } from '../viewer/burnLayer';
import { flyToGrid, flyTopDown } from '../viewer/camera';
import type { Viewer } from 'cesium';
import { createDispatchOverlay } from '../viewer/dispatchOverlay';
import { createGridOutline } from '../viewer/gridOutline';
import type { GridOutline } from '../viewer/gridOutline';
import { createIgnitionMarker } from '../viewer/ignitionMarker';
import { createFireEffects } from '../viewer/particles';
import { createPicker } from '../viewer/picking';
import type { PickedCell, Picker } from '../viewer/picking';
import type { Notices } from '../ui/notices';
import { STR } from '../ui/strings';
import { OverlayPainter } from './overlayPainter';
import type { Preview } from './overlayPainter';
import { SimCancelledError, SimClient } from './simClient';
import type { Store } from './state';

interface AreaContext {
  burn: GridLayer;
  fuel: GridLayer;
  slope: GridLayer;
  outline: GridOutline;
  painter: OverlayPainter;
}

export interface Wiring {
  selectArea(name: string): Promise<void>;
  simulate(): Promise<void>;
  startWithoutIntervention(): Promise<void>;
  startWithContainmentAi(): Promise<void>;
  recommendPlan(): Promise<void>;
  toggleOrder(orderId: string, enabled: boolean): void;
  highlightOrder(orderId: string | null): void;
  flyToOrder(orderId: string): void;
  stopTrackingOrder(): void;
  cancel(): void;
  topDown(): void;
  resetView(): void;
  picker: Picker;
  /** Hook for the tools controller: receives picks when a drawing tool is active. */
  setDrawHandlers(h: { start(c: PickedCell): void; move(c: PickedCell): void; end(): void } | null): void;
  /** Live stroke preview painted into the overlay. */
  setPreview(p: Preview | null): void;
  /** Dev/test helper: feeds a stroke (cell-space points) through the draw handlers as if dragged. */
  debugStroke(points: { x: number; y: number }[]): void;
}

export function wire(viewer: Viewer, store: Store, notices: Notices): Wiring {
  const sim = new SimClient();
  const marker = createIgnitionMarker(viewer, STR.ignitionLabel);
  const dispatchOverlay = createDispatchOverlay(viewer);
  const effects = createFireEffects(viewer);
  effects.setEnabled(store.get().effects.particles);
  effects.setQuality(store.get().effects.quality);
  let ctx: AreaContext | null = null;
  let draw: { start(c: PickedCell): void; move(c: PickedCell): void; end(): void } | null = null;
  let preview: Preview | null = null;

  const picker = createPicker(viewer, () => store.get().area?.grid ?? null, {
    onClick: (cell) => {
      const s = store.get();
      if (!s.area) return;
      if (s.tool !== 'ignite') return;
      const fuel = s.area.fuel[cell.row * s.area.grid.width + cell.col];
      if (fuel === FuelClass.NONE) {
        notices.show(STR.ignitionNonBurnable, 'warn', 4000);
        return;
      }
      const nextIgn = { row: cell.row, col: cell.col };
      const dipSite = findBestDipSite(s.area, nextIgn);
      dispatchOverlay.stopTracking();
      store.update((st) => ({
        ignition: nextIgn,
        dipSite,
        agentPlan: null,
        trackedOrderId: null,
        highlightedOrderId: null,
        interventions: st.interventions.filter((iv) => !iv.id.startsWith('agent-')),
        resultStale: !!st.result,
      }));
    },
    onDragStart: (c) => draw?.start(c),
    onDragMove: (c) => draw?.move(c),
    onDragEnd: () => draw?.end(),
    onOutside: () => notices.show(STR.ignitionOutside, 'info', 3000),
  });

  function disposeArea(): void {
    if (!ctx) return;
    ctx.painter.destroy();
    ctx.burn.destroy();
    ctx.fuel.destroy();
    ctx.slope.destroy();
    ctx.outline.destroy();
    ctx = null;
  }

  function buildArea(): void {
    disposeArea();
    const s = store.get();
    if (!s.area) return;
    const { grid } = s.area;
    const fuel = new GridLayer(viewer, grid, { zIndex: 1 });
    fuel.paint((d) => paintFuel(d, s.area!.fuel));
    const slope = new GridLayer(viewer, grid, { zIndex: 2 });
    const { slopeDeg } = computeSlopeAspect(s.area.elevation, grid.width, grid.height, grid.cellSizeM);
    slope.paint((d) => paintSlope(d, slopeDeg));
    const burn = new GridLayer(viewer, grid, { zIndex: 3 });
    const outline = createGridOutline(viewer, grid);
    ctx = { burn, fuel, slope, outline, painter: new OverlayPainter(burn, grid) };
    applyDebug();
    repaint();
    marker.set(grid, s.ignition);
    dispatchOverlay.setStationsAndDipSite(s.stations, s.dipSite);
    dispatchOverlay.setOrders(
      grid,
      s.agentPlan?.orders ?? [],
      s.highlightedOrderId,
      s.area.elevation,
      s.viewerMode === 'google',
    );
    flyToGrid(viewer, grid);
  }

  function applyDebug(): void {
    if (!ctx) return;
    const d = store.get().debug;
    ctx.fuel.setVisible(d.fuel);
    ctx.slope.setVisible(d.slope);
    ctx.outline.setVisible(d.outline);
  }

  function repaint(): void {
    if (!ctx) return;
    const s = store.get();
    ctx.painter.schedule(s.result, s.interventions, s.playback.t, s.settings, preview);
    dispatchOverlay.updateTime(s.playback.t);
    if (s.area) {
      const toward = (windTowardDeg(s.weather.windFromDeg) * Math.PI) / 180;
      effects.update({
        grid: s.area.grid,
        arrival: s.result?.arrivalTime ?? null,
        elevation: s.area.elevation,
        t: s.playback.t,
        windX: Math.sin(toward),
        windY: Math.cos(toward),
        windSpeedMps: s.weather.windSpeedMps,
        useElevation: s.viewerMode === 'google',
      });
    }
  }

  store.subscribe((s, prev) => {
    if (s.area !== prev.area) buildArea();
    if (!ctx) return;
    if (s.debug !== prev.debug) applyDebug();
    if (s.ignition !== prev.ignition && s.area) marker.set(s.area.grid, s.ignition);
    if (s.stations !== prev.stations || s.dipSite !== prev.dipSite) {
      dispatchOverlay.setStationsAndDipSite(s.stations, s.dipSite);
    }
    if (s.agentPlan !== prev.agentPlan || s.viewerMode !== prev.viewerMode) {
      dispatchOverlay.setOrders(
        s.area?.grid ?? null,
        s.agentPlan?.orders ?? [],
        s.highlightedOrderId,
        s.area?.elevation ?? null,
        s.viewerMode === 'google',
      );
      dispatchOverlay.updateTime(s.playback.t);
    } else if (s.highlightedOrderId !== prev.highlightedOrderId) {
      dispatchOverlay.setHighlightedOrder(s.highlightedOrderId);
    }
    if (s.trackedOrderId !== prev.trackedOrderId && !s.trackedOrderId) {
      dispatchOverlay.stopTracking();
    }
    if (s.result !== prev.result || s.playback.t !== prev.playback.t || s.interventions !== prev.interventions || s.settings !== prev.settings) repaint();
    if (s.tool !== prev.tool) picker.setDragMode(s.tool !== 'ignite');
    if (s.effects !== prev.effects) {
      effects.setEnabled(s.effects.particles);
      effects.setQuality(s.effects.quality);
      repaint();
    }
  });

  async function selectArea(name: string): Promise<void> {
    const entry = store.get().areas.find((a) => a.name === name);
    if (!entry) {
      notices.show(STR.liveAreaUnavailable, 'info');
      return;
    }
    store.set({ areaLoading: true, simError: null });
    sim.cancelAll();
    dispatchOverlay.stopTracking();
    try {
      const area = await loadDemoArea(entry);
      const ignition = defaultIgnition(area);
      const dipSite = findBestDipSite(area, ignition);
      store.set({
        area,
        areaLoading: false,
        ignition,
        dipSite,
        stations: [],
        agentPlan: null,
        agentRunning: false,
        highlightedOrderId: null,
        trackedOrderId: null,
        interventions: [],
        result: null,
        resultStale: false,
        simRunning: false,
        playback: { ...store.get().playback, t: 0, playing: false },
        weather: { ...store.get().weather, windFromDeg: area.meta.defaultWindFromDeg ?? store.get().weather.windFromDeg },
      });

      // Discover real Overpass fire stations & OSRM road travel times (with regional fallback)
      const stations = await discoverFireStations(area);
      if (store.get().area === area) {
        store.set({ stations });
      }
    } catch (err) {
      store.set({ areaLoading: false });
      notices.show(`${STR.loadError} ${err instanceof Error ? err.message : String(err)}`, 'error', 8000);
    }
  }

  function buildScenario(interventionsOverride?: Scenario['interventions']): Scenario | string {
    const s = store.get();
    if (!s.area) return STR.loadError;
    if (!s.ignition) return STR.placeIgnitionHint;
    if (s.area.fuel[s.ignition.row * s.area.grid.width + s.ignition.col] === FuelClass.NONE) return STR.ignitionNonBurnable;
    const scenario = scenarioFromArea(s.area, {
      weather: s.weather,
      settings: s.settings,
      ignition: [s.ignition],
      durationSeconds: s.durationSeconds,
      seed: s.seed,
    });
    scenario.interventions = interventionsOverride ?? s.interventions;
    const errors = validateScenario(scenario);
    return errors.length ? errors[0] : scenario;
  }

  async function simulate(): Promise<void> {
    const scenario = buildScenario();
    if (typeof scenario === 'string') {
      store.set({ simError: scenario });
      return;
    }
    store.set({ simRunning: true, simError: null });
    try {
      const result = await sim.run(scenario);
      const s = store.get();
      const firstRun = !s.result;
      const t = Math.min(s.playback.t, s.durationSeconds);
      store.set({
        result,
        resultStale: false,
        simRunning: false,
        playback: { ...s.playback, t: firstRun ? 0 : t, playing: firstRun ? true : s.playback.playing },
      });
    } catch (err) {
      if (err instanceof SimCancelledError) return;
      store.set({ simRunning: false, simError: `${STR.simFailed} ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  async function startWithoutIntervention(): Promise<void> {
    dispatchOverlay.stopTracking();
    const manualOnly = store.get().interventions.filter((iv) => !iv.id.startsWith('agent-'));
    const scenario = buildScenario(manualOnly);
    if (typeof scenario === 'string') {
      store.set({ simError: scenario });
      return;
    }
    store.set({
      simRunning: true,
      agentRunning: false,
      simError: null,
      agentPlan: null,
      trackedOrderId: null,
      highlightedOrderId: null,
      interventions: manualOnly,
    });
    try {
      const result = await sim.run(scenario);
      const s = store.get();
      store.set({
        result,
        resultStale: false,
        simRunning: false,
        playback: { ...s.playback, t: 0, playing: true },
      });
    } catch (err) {
      if (err instanceof SimCancelledError) return;
      store.set({ simRunning: false, simError: `${STR.simFailed} ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  async function startWithContainmentAi(): Promise<void> {
    const s0 = store.get();
    if (!s0.area || s0.simRunning || s0.agentRunning) return;
    dispatchOverlay.stopTracking();
    const manualOnly = s0.interventions.filter((iv) => !iv.id.startsWith('agent-'));
    const baselineScenario = buildScenario(manualOnly);
    if (typeof baselineScenario === 'string') {
      store.set({ simError: baselineScenario });
      return;
    }

    store.set({
      simRunning: true,
      agentRunning: true,
      simError: null,
      trackedOrderId: null,
      highlightedOrderId: null,
      interventions: manualOnly,
    });

    try {
      // Step 1: Compute baseline wildfire spread
      const baselineResult = await sim.run(baselineScenario);
      const s1 = store.get();
      if (!s1.area) return;

      // Step 2: Ensure fire stations are discovered
      let stations = s1.stations;
      if (stations.length === 0) {
        stations = await discoverFireStations(s1.area);
        store.set({ stations });
      }

      // Step 3: Compute multi-wave hybrid tactic containment plan (Water Spray vs Fire Break)
      const plan = await generateTacticalContainmentPlan(
        s1.area,
        baselineScenario,
        baselineResult,
        stations,
        s1.dipSite,
        0,
      );

      // Step 4: Automatically deploy enabled AI interventions and run contained simulation
      const enabledInterventions = plan.orders
        .filter((o) => o.enabled)
        .map((o) => o.intervention);
      const mergedInterventions = [...manualOnly, ...enabledInterventions];
      const containedScenario = buildScenario(mergedInterventions);
      const finalResult =
        typeof containedScenario === 'string'
          ? baselineResult
          : await sim.run(containedScenario);

      const s2 = store.get();
      store.set({
        agentPlan: plan,
        interventions: mergedInterventions,
        result: finalResult,
        resultStale: false,
        simRunning: false,
        agentRunning: false,
        playback: { ...s2.playback, t: 0, playing: true },
      });

      notices.show(
        `AI Containment deployed (${enabledInterventions.length} orders · -${plan.savedHa.toFixed(1)} ha saved). Click any radio card to track in 3D.`,
        'info',
        5000,
      );
    } catch (err) {
      if (err instanceof SimCancelledError) {
        store.set({ simRunning: false, agentRunning: false });
        return;
      }
      store.set({
        simRunning: false,
        agentRunning: false,
        simError: `${STR.simFailed} ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  async function recommendPlan(): Promise<void> {
    await startWithContainmentAi();
  }

  function toggleOrder(orderId: string, enabled: boolean): void {
    const plan = store.get().agentPlan;
    if (!plan) return;
    const orders = plan.orders.map((o) => (o.id === orderId ? { ...o, enabled } : o));
    store.set({ agentPlan: { ...plan, orders } });
  }

  function highlightOrder(orderId: string | null): void {
    if (store.get().highlightedOrderId === orderId) return;
    store.set({ highlightedOrderId: orderId });
  }

  function flyToOrder(orderId: string): void {
    store.set({ trackedOrderId: orderId, highlightedOrderId: orderId });
    dispatchOverlay.flyToActiveUnit(orderId, store.get().playback.t);
  }

  function stopTrackingOrder(): void {
    dispatchOverlay.stopTracking();
    if (store.get().trackedOrderId !== null) {
      store.set({ trackedOrderId: null });
    }
  }

  return {
    selectArea,
    simulate,
    startWithoutIntervention,
    startWithContainmentAi,
    recommendPlan,
    toggleOrder,
    highlightOrder,
    flyToOrder,
    stopTrackingOrder,
    cancel: () => {
      sim.cancelAll();
      store.set({ simRunning: false, agentRunning: false });
    },
    topDown: () => {
      stopTrackingOrder();
      const g = store.get().area?.grid;
      if (g) flyTopDown(viewer, g);
    },
    resetView: () => {
      stopTrackingOrder();
      const g = store.get().area?.grid;
      if (g) flyToGrid(viewer, g);
    },
    picker,
    setDrawHandlers: (h) => {
      draw = h;
    },
    setPreview: (p) => {
      preview = p;
      repaint();
    },
    debugStroke: (points) => {
      if (!draw || points.length === 0) return;
      const toCell = (p: { x: number; y: number }): PickedCell => ({ x: p.x, y: p.y, row: Math.floor(p.y), col: Math.floor(p.x), lon: 0, lat: 0 });
      draw.start(toCell(points[0]));
      for (const p of points.slice(1)) draw.move(toCell(p));
      draw.end();
    },
  };
}
