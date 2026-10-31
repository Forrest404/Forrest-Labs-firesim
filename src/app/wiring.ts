/**
 * Glue between the store, the Cesium viewer and the simulation worker. The only place where
 * viewer objects are created in response to state changes.
 */

import { FuelClass, ensembleSpecFrom, scheduleFromPreset, validateScenario, windTowardDeg } from '../contract';
import type { Scenario } from '../contract';
import { scenarioFromArea } from '../data/bundle';
import { loadDemoArea } from '../data/demoAreas';
import { perimetersToGeoJSON, probabilityToGeoJSON } from '../export/geojson';
import { defaultIgnition } from '../data/ignition';
import { computeSlopeAspect } from '../data/terrain';
import { paintFuel, paintSlope } from '../viewer/burnCanvas';
import { GridLayer } from '../viewer/burnLayer';
import { flyToGrid, flyTopDown } from '../viewer/camera';
import type { Viewer } from 'cesium';
import { createGridOutline } from '../viewer/gridOutline';
import type { GridOutline } from '../viewer/gridOutline';
import { createIgnitionMarker } from '../viewer/ignitionMarker';
import { createFireEffects } from '../viewer/particles';
import { createPicker } from '../viewer/picking';
import type { PickedCell, Picker } from '../viewer/picking';
import type { Notices } from '../ui/notices';
import { STR } from '../ui/strings';
import { downloadJson, exportFilename } from './download';
import { OverlayPainter } from './overlayPainter';
import { ProbabilityPainter } from './probabilityPainter';
import type { Preview } from './overlayPainter';
import { SimCancelledError, SimClient } from './simClient';
import type { Store } from './state';

interface AreaContext {
  burn: GridLayer;
  fuel: GridLayer;
  slope: GridLayer;
  prob: GridLayer;
  outline: GridOutline;
  painter: OverlayPainter;
  probPainter: ProbabilityPainter;
}

export interface Wiring {
  selectArea(name: string): Promise<void>;
  simulate(): Promise<void>;
  cancel(): void;
  runEnsemble(): Promise<void>;
  cancelEnsemble(): void;
  exportPerimeters(): void;
  exportProbability(): void;
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
      store.update((st) => ({ ignition: { row: cell.row, col: cell.col }, resultStale: !!st.result }));
    },
    onDragStart: (c) => draw?.start(c),
    onDragMove: (c) => draw?.move(c),
    onDragEnd: () => draw?.end(),
    onOutside: () => notices.show(STR.ignitionOutside, 'info', 3000),
  });

  function disposeArea(): void {
    if (!ctx) return;
    ctx.painter.destroy();
    ctx.probPainter.destroy();
    ctx.prob.destroy();
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
    const prob = new GridLayer(viewer, grid, { zIndex: 4 });
    ctx = { burn, fuel, slope, prob, outline, painter: new OverlayPainter(burn, grid), probPainter: new ProbabilityPainter(prob, grid.width * grid.height) };
    applyDebug();
    repaint();
    marker.set(grid, s.ignition);
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
    // The probability map sits above the single run; the single run fades back so it stays readable.
    const showProb = s.showProbability && !!s.ensemble.result;
    ctx.burn.setAlpha(showProb ? 0.3 : 1);
    ctx.probPainter.schedule(showProb ? s.ensemble.result : null, s.playback.t);
    if (s.area) {
      const toward = (windTowardDeg(s.weather.windFromDeg) * Math.PI) / 180;
      effects.update({
        grid: s.area.grid,
        arrival: s.result?.arrivalTime ?? null,
        elevation: s.area.elevation,
        flameLengthM: s.result?.flameLengthM ?? null,
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
    if (s.result !== prev.result || s.playback.t !== prev.playback.t || s.interventions !== prev.interventions || s.settings !== prev.settings) repaint();
    if (s.ensemble.result !== prev.ensemble.result || s.showProbability !== prev.showProbability) repaint();
    // An ensemble describes the inputs it was run with: flag it stale when any of them change.
    if (s.ensemble.result && !s.ensemble.stale && (s.weather !== prev.weather || s.weatherPreset !== prev.weatherPreset || s.settings !== prev.settings
      || s.durationSeconds !== prev.durationSeconds || s.ignition !== prev.ignition || s.interventions !== prev.interventions || s.seed !== prev.seed)) {
      store.set({ ensemble: { ...s.ensemble, stale: true } });
    }
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
    try {
      const area = await loadDemoArea(entry);
      store.set({
        area,
        areaLoading: false,
        ignition: defaultIgnition(area),
        interventions: [],
        result: null,
        resultStale: false,
        simRunning: false,
        ensemble: { ...store.get().ensemble, running: false, progress: 0, result: null, stale: false, error: null },
        showProbability: false,
        playback: { ...store.get().playback, t: 0, playing: false },
        weather: { ...store.get().weather, windFromDeg: area.meta.defaultWindFromDeg ?? store.get().weather.windFromDeg },
      });
    } catch (err) {
      store.set({ areaLoading: false });
      notices.show(`${STR.loadError} ${err instanceof Error ? err.message : String(err)}`, 'error', 8000);
    }
  }

  function buildScenario(): Scenario | string {
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
    scenario.interventions = s.interventions;
    scenario.weatherSchedule = scheduleFromPreset(s.weatherPreset, s.weather);
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

  async function runEnsemble(): Promise<void> {
    const scenario = buildScenario();
    if (typeof scenario === 'string') {
      store.set({ ensemble: { ...store.get().ensemble, error: scenario } });
      return;
    }
    const e0 = store.get().ensemble;
    const spec = ensembleSpecFrom(e0.runs, e0.uncertainty, e0.ignitionJitterCells, store.get().seed);
    store.set({ ensemble: { ...e0, running: true, progress: 0, error: null }, simRunning: false });
    try {
      const result = await sim.runEnsemble(scenario, spec, (fraction) => store.set({ ensemble: { ...store.get().ensemble, progress: fraction } }));
      store.set({ ensemble: { ...store.get().ensemble, running: false, progress: 1, result, stale: false, error: null }, showProbability: true });
    } catch (err) {
      if (err instanceof SimCancelledError) {
        store.set({ ensemble: { ...store.get().ensemble, running: false, progress: 0 } });
        return;
      }
      store.set({ ensemble: { ...store.get().ensemble, running: false, error: `${STR.ensembleFailed} ${err instanceof Error ? err.message : String(err)}` } });
    }
  }

  function exportContext(): { grid: NonNullable<ReturnType<Store['get']>['area']>['grid']; areaName: string; areaIsSynthetic: boolean; attribution: string[] } | null {
    const a = store.get().area;
    return a ? { grid: a.grid, areaName: a.meta.label, areaIsSynthetic: a.meta.synthetic, attribution: a.meta.attribution } : null;
  }

  return {
    selectArea,
    simulate,
    runEnsemble,
    exportPerimeters: () => {
      const s = store.get();
      const ctxe = exportContext();
      if (!ctxe || !s.result) return;
      const fc = perimetersToGeoJSON(ctxe, s.result, { durationSeconds: s.durationSeconds, ignition: s.ignition ? [s.ignition] : [], interventions: s.interventions });
      downloadJson(exportFilename('perimeters', s.area!.meta.name), fc);
    },
    exportProbability: () => {
      const s = store.get();
      const ctxe = exportContext();
      if (!ctxe || !s.ensemble.result) return;
      downloadJson(exportFilename('probability', s.area!.meta.name), probabilityToGeoJSON(ctxe, s.ensemble.result));
    },
    cancelEnsemble: () => {
      sim.cancelAll();
      store.set({ ensemble: { ...store.get().ensemble, running: false, progress: 0 } });
    },
    cancel: () => {
      sim.cancelAll();
      store.set({ simRunning: false });
    },
    topDown: () => {
      const g = store.get().area?.grid;
      if (g) flyTopDown(viewer, g);
    },
    resetView: () => {
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
