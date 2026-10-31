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
import { flyToGlobe, flyToGrid, flyToPoint, flyTopDown } from '../viewer/camera';
import type { Backdrop } from '../viewer/createViewer';
import { gridCenter } from '../data/geo';
import { createHotspotLayer } from '../viewer/hotspotLayer';
import type { Viewer } from 'cesium';
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
import type { AppState, Store } from './state';

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
  /** Live view: oblique fly-to of a lon/lat from `rangeM` away. */
  flyToLonLat(lon: number, lat: number, rangeM: number): void;
}

export interface WireOptions {
  /** Switches the backdrop between Google tiles and the globe (see createViewer). */
  setBackdrop?: (mode: Backdrop) => void;
}

export function wire(viewer: Viewer, store: Store, notices: Notices, opts: WireOptions = {}): Wiring {
  const sim = new SimClient();
  const marker = createIgnitionMarker(viewer, STR.ignitionLabel);
  const effects = createFireEffects(viewer);
  effects.setEnabled(store.get().effects.particles);
  effects.setQuality(store.get().effects.quality);
  // Live-fires detections. Picks arrive from a Cesium event, so the store write is deferred anyway.
  const hotspots = createHotspotLayer(viewer, (id) => {
    if (store.get().view !== 'live') return;
    queueMicrotask(() => store.update((st) => (st.live.selectedId === id ? {} : { live: { ...st.live, selectedId: id } })));
  });
  const simShown = (): boolean => store.get().view === 'sim';
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
    effects.setEnabled(!live && s.effects.particles);
    hotspots.setVisible(live);
    if (ctx) {
      ctx.burn.setVisible(!live);
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
    if (s.view !== prev.view) applyView(s);
    if (s.live.filtered !== prev.live.filtered) hotspots.set(s.live.filtered, Date.now());
    if (s.live.selectedId !== prev.live.selectedId) hotspots.setSelected(s.live.selectedId);
    if (!ctx) return;
    if (s.debug !== prev.debug) applyDebug();
    if (s.ignition !== prev.ignition && s.area) marker.set(s.area.grid, s.ignition);
    if (s.result !== prev.result || s.playback.t !== prev.playback.t || s.interventions !== prev.interventions || s.settings !== prev.settings) repaint();
    if (s.tool !== prev.tool) picker.setDragMode(s.tool !== 'ignite');
    if (s.effects !== prev.effects) {
      effects.setEnabled(s.effects.particles && simShown());
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
