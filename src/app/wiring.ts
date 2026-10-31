/**
 * Glue between the store, the Cesium viewer and the simulation worker. The only place where
 * viewer objects are created in response to state changes.
 */

import { FuelClass, validateScenario, windTowardDeg } from '../contract';
import type { Scenario } from '../contract';
import { scenarioFromArea } from '../data/bundle';
import { loadDemoArea } from '../data/demoAreas';
import { defaultIgnition } from '../data/ignition';
import { computeSlopeAspect } from '../data/terrain';
import { paintFuel, paintSlope } from '../viewer/burnCanvas';
import { GridLayer } from '../viewer/burnLayer';
import { flyToCell, flyToGlobe, flyToGrid, flyToPoint, flyTopDown } from '../viewer/camera';
import type { Backdrop, Basemap } from '../viewer/createViewer';
import { gridCenter } from '../data/geo';
import { createHotspotLayer } from '../viewer/hotspotLayer';
import { createRegionLayer } from '../viewer/regionLayer';
import type { Viewer } from 'cesium';
import { createGridOutline } from '../viewer/gridOutline';
import type { GridOutline } from '../viewer/gridOutline';
import { createIgnitionMarker } from '../viewer/ignitionMarker';
import { createFireEffects } from '../viewer/particles';
import { createPicker } from '../viewer/picking';
import type { PickedCell, Picker } from '../viewer/picking';
import type { Notices } from '../ui/notices';
import { STR } from '../ui/strings';
import { OVERLAY_SCALE, OverlayPainter } from './overlayPainter';
import { SmokeTimeline } from './smoke';
import type { Preview } from './overlayPainter';
import { SimCancelledError, SimClient } from './simClient';
import type { AppState, Store } from './state';

interface AreaContext {
  burn: GridLayer;
  smoke: GridLayer;
  fuel: GridLayer;
  slope: GridLayer;
  outline: GridOutline;
  painter: OverlayPainter;
}

export interface Wiring {
  selectArea(name: string): Promise<void>;
  simulate(): Promise<void>;
  cancel(): void;
  topDown(): void;
  resetView(): void;
  picker: Picker;
  /** Close-up on the ignition cell (dev hook / headless checks; a UI button can reuse it). */
  focusIgnition(rangeM?: number): void;
  /** The smoke timeline of the current result (dev hook / headless checks). */
  smokeTimeline(): SmokeTimeline | null;
  /** Hook for the tools controller: receives picks when a drawing tool is active. */
  setDrawHandlers(h: { start(c: PickedCell): void; move(c: PickedCell): void; end(): void } | null): void;
  /** Live stroke preview painted into the overlay. */
  setPreview(p: Preview | null): void;
  /** Dev/test helper: feeds a stroke (cell-space points) through the draw handlers as if dragged. */
  debugStroke(points: { x: number; y: number }[]): void;
  /** Live view: oblique fly-to of a lon/lat from `rangeM` away. */
  flyToLonLat(lon: number, lat: number, rangeM: number): void;
}

export interface WireOptions {
  /** Switches the backdrop between Google tiles and the globe (see createViewer). */
  setBackdrop?: (mode: Backdrop) => void;
  /** Swaps the globe imagery (streets / satellite). */
  setBasemap?: (basemap: Basemap) => void;
}

export function wire(viewer: Viewer, store: Store, notices: Notices, opts: WireOptions = {}): Wiring {
  const sim = new SimClient();
  const marker = createIgnitionMarker(viewer, STR.ignitionLabel);
  const effects = createFireEffects(viewer);
  effects.setFlags(store.get().effects);
  effects.setQuality(store.get().effects.quality);
  // Live-fires detections. Picks arrive from a Cesium event, so the store write is deferred anyway.
  const hotspots = createHotspotLayer(viewer, (id) => {
    if (store.get().view !== 'live') return;
    queueMicrotask(() => store.update((st) => {
      const L = st.live;
      if (L.selectedId === id && (id !== null || L.selectedRegionId === null)) return {};
      return { live: { ...L, selectedId: id, selectedRegionId: null } };
    }));
  });
  const regions = createRegionLayer(viewer, (id) => {
    if (store.get().view !== 'live') return;
    queueMicrotask(() => store.update((st) => (st.live.selectedRegionId === id ? {} : { live: { ...st.live, selectedRegionId: id, selectedId: null } })));
  });
  const applyLiveLayers = (s: AppState): void => {
    const live = s.view === 'live';
    hotspots.setVisible(live && s.live.layers.dots);
    regions.setVisible(live && s.live.layers.regions);
  };
  const simShown = (): boolean => store.get().view === 'sim';
  /** Particle switches as set, except in the live view where every particle system is off. */
  const applyEffects = (s: AppState): void => {
    effects.setFlags(s.view === 'sim' ? s.effects : { ...s.effects, flames: false, embers: false, smokeParticles: false });
  };
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
    ctx.burn.destroy();
    ctx.smoke.destroy();
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
    const burn = new GridLayer(viewer, grid, { zIndex: 3, scale: OVERLAY_SCALE });
    const smoke = new GridLayer(viewer, grid, { zIndex: 4, scale: OVERLAY_SCALE });
    smoke.setVisible(s.effects.smoke && simShown());
    const outline = createGridOutline(viewer, grid);
    const painter = new OverlayPainter(burn, grid);
    painter.setSmoke(smoke, null);
    painter.setEffects({ glow: s.effects.glow, smooth: s.effects.smooth });
    ctx = { burn, smoke, fuel, slope, outline, painter };
    applyDebug();
    repaint();
    marker.set(grid, s.ignition);
    if (simShown()) flyToGrid(viewer, grid);
    else burn.setVisible(false);
  }

  function applyDebug(): void {
    if (!ctx) return;
    const d = store.get().debug;
    const on = simShown();
    ctx.fuel.setVisible(on && d.fuel);
    ctx.slope.setVisible(on && d.slope);
    ctx.outline.setVisible(on && d.outline);
  }

  /** Tab switch: hide every sim object in the live view and show the detections, or the reverse. */
  function applyView(s: AppState): void {
    const live = s.view === 'live';
    opts.setBackdrop?.(live ? 'globe' : 'tiles');
    picker.setEnabled(!live);
    if (!live) picker.setDragMode(s.tool !== 'ignite');
    marker.setVisible(!live);
    applyEffects(s);
    applyLiveLayers(s);
    if (ctx) {
      ctx.burn.setVisible(!live);
      ctx.smoke.setVisible(!live && s.effects.smoke);
      applyDebug();
    }
    if (live) {
      const c = s.area ? gridCenter(s.area.grid) : { lon: 0, lat: 20 };
      flyToGlobe(viewer, c.lon, c.lat);
    } else if (s.area) {
      flyToGrid(viewer, s.area.grid);
      repaint();
    }
  }

  function repaint(): void {
    if (!ctx) return;
    const s = store.get();
    ctx.painter.schedule(s.result, s.interventions, s.playback.t, s.settings, preview);
    if (s.area) {
      const toward = (windTowardDeg(s.weather.windFromDeg) * Math.PI) / 180;
      const sample = ctx.painter.lastSmokeSample;
      effects.update({
        grid: s.area.grid,
        arrival: s.result?.arrivalTime ?? null,
        elevation: s.area.elevation,
        t: s.playback.t,
        windX: Math.sin(toward),
        windY: Math.cos(toward),
        windSpeedMps: s.weather.windSpeedMps,
        useElevation: s.viewerMode === 'google',
        playbackSpeed: s.playback.speed,
        fuel: s.area.fuel,
        intensity: s.result?.intensity ?? null,
        maxRateMps: s.result?.stats.maxSpreadRateMps ?? 0,
        smoke: s.result && sample
          ? { emission: sample.emission, refEmission: sample.refEmission, burnoutAt: sample.burnoutAt, plumeTopM: sample.plumeTopM, smolderFrac: sample.smolderFrac }
          : null,
      });
    }
  }

  store.subscribe((s, prev) => {
    if (s.area !== prev.area) buildArea();
    if (s.view !== prev.view) applyView(s);
    if (s.live.filtered !== prev.live.filtered) hotspots.set(s.live.filtered, Date.now());
    if (s.live.regions !== prev.live.regions) regions.set(s.live.regions, Date.now());
    if (s.live.selectedId !== prev.live.selectedId) hotspots.setSelected(s.live.selectedId);
    if (s.live.selectedRegionId !== prev.live.selectedRegionId) regions.setSelected(s.live.selectedRegionId);
    if (s.live.layers !== prev.live.layers) applyLiveLayers(s);
    if (s.live.basemap !== prev.live.basemap) opts.setBasemap?.(s.live.basemap);
    if (!ctx) return;
    if (s.debug !== prev.debug) applyDebug();
    if (s.ignition !== prev.ignition && s.area) marker.set(s.area.grid, s.ignition);
    if (s.result !== prev.result && !s.result) {
      ctx.painter.setSmoke(ctx.smoke, null);
      ctx.painter.setBurnout(null);
    }
    if (s.result !== prev.result || s.playback.t !== prev.playback.t || s.interventions !== prev.interventions || s.settings !== prev.settings) repaint();
    if (s.tool !== prev.tool) picker.setDragMode(s.tool !== 'ignite');
    if (s.effects !== prev.effects) {
      applyEffects(s);
      effects.setQuality(s.effects.quality);
      ctx.smoke.setVisible(s.effects.smoke && simShown());
      ctx.painter.setEffects({ glow: s.effects.glow, smooth: s.effects.smooth });
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
      if (ctx) {
        // Smoke follows the scenario that produced this result, not the live (possibly edited) weather.
        const timeline = new SmokeTimeline({
          grid: scenario.grid,
          fuel: scenario.fuel,
          elevation: scenario.elevation,
          arrival: result.arrivalTime,
          intensity: result.intensity,
          weather: scenario.weather,
          seed: scenario.seed,
          durationS: scenario.durationSeconds,
        });
        ctx.painter.setSmoke(ctx.smoke, timeline);
        ctx.painter.setBurnout(timeline.burnoutAt);
      }
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

  return {
    selectArea,
    simulate,
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
    focusIgnition: (rangeM = 600) => {
      const s = store.get();
      if (!s.area || !s.ignition) return;
      const h = s.viewerMode === 'google' ? s.area.elevation[s.ignition.row * s.area.grid.width + s.ignition.col] : 0;
      flyToCell(viewer, s.area.grid, s.ignition, h, rangeM);
    },
    smokeTimeline: () => ctx?.painter.smokeTimeline ?? null,
    setDrawHandlers: (h) => {
      draw = h;
    },
    setPreview: (p) => {
      preview = p;
      repaint();
    },
    flyToLonLat: (lon, lat, rangeM) => flyToPoint(viewer, lon, lat, rangeM),
    debugStroke: (points) => {
      if (!draw || points.length === 0) return;
      const toCell = (p: { x: number; y: number }): PickedCell => ({ x: p.x, y: p.y, row: Math.floor(p.y), col: Math.floor(p.x), lon: 0, lat: 0 });
      draw.start(toCell(points[0]));
      for (const p of points.slice(1)) draw.move(toCell(p));
      draw.end();
    },
  };
}
