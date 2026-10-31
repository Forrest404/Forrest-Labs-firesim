/**
 * Glue between the store, the Cesium viewer and the simulation worker. The only place where
 * viewer objects are created in response to state changes.
 */

import { DEFAULT_SETTINGS, FuelClass, validateScenario, windTowardDeg } from '../contract';
import type { GridSpec, Scenario, SimResult } from '../contract';
import { simulate as runSimulation } from '../sim';
import type { DemoArea } from '../data/bundle';
import { buildLiveArea, fetchLiveFires } from '../data/liveFire';
import type { LiveFire } from '../data/liveFire';
import { createReferenceOutline } from '../viewer/referenceOutline';
import type { ReferenceOutline } from '../viewer/referenceOutline';
import { overlapAtRealSize } from './impact';
import { controlRuns } from './realFire';
import type { ContainPlan } from '../contain';
import { createDispatchOverlay } from '../viewer/dispatchOverlay';
import { scenarioFromArea } from '../data/bundle';
import { loadDemoArea } from '../data/demoAreas';
import { defaultIgnition } from '../data/ignition';
import { computeSlopeAspect } from '../data/terrain';
import { FORECAST_RINGS, forecastRingCells, paintFuel, paintSlope } from '../viewer/burnCanvas';
import { GridLayer } from '../viewer/burnLayer';
import { flyToCell, flyToGlobe, flyToGrid, flyToGround, flyToPoint, flyTopDown, groundPose } from '../viewer/camera';
import type { Backdrop, Basemap } from '../viewer/createViewer';
import { cellCenterLonLat, gridCenter, lonLatToCell } from '../data/geo';
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

/** Playback speed for "Real vs simulation": Crozier reaches real size (~11 h) in about 20 s. */
const REAL_VS_SIM_SPEED = 2048;
/** Live forecast playback: 6 h in about 10 s. */
const LIVE_FORECAST_SPEED = 2048;
/** Ground view: cells that ignited this recently count as the front the camera watches. */
const GROUND_FRONT_WINDOW_S = 1800;
/** Ground view re-aims at most this often while playing, gliding between poses. */
const GROUND_FOLLOW_INTERVAL_MS = 700;

interface AreaContext {
  burn: GridLayer;
  smoke: GridLayer;
  fuel: GridLayer;
  slope: GridLayer;
  outline: GridOutline;
  reference: ReferenceOutline | null;
  painter: OverlayPainter;
}

export interface Wiring {
  selectArea(name: string): Promise<void>;
  simulate(): Promise<void>;
  /** Re-runs the area's real fire (recorded weather and ignition), jumps to real size, shows accuracy colours. */
  compareWithRealFire(): Promise<void>;
  /** Re-runs the real fire from ignition with the real perimeter and our run side by side. */
  realVsSim(): Promise<void>;
  /** The scenario the current inputs describe, or a user-facing reason why there isn't one. */
  buildScenario(): Scenario | string;
  /** Toggles the ground view that follows the fire front. */
  groundView(): void;
  /** Loads the fires reported now (NIFC). */
  loadLiveFires(): Promise<void>;
  /** Builds the area around a live fire and forecasts the next hours. */
  predictLiveFire(fire: LiveFire): Promise<void>;
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
  const dispatch = createDispatchOverlay(viewer);
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
  /** Scenario of the current result, kept so the smoke field can follow a flip between the two runs. */
  let lastScenario: Scenario | null = null;
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
    ctx.reference?.destroy();
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
    const area = s.area;
    // On 3D tiles the wall stands on the real ground; on the flat fallback globe it starts at 0 m.
    const groundAt = s.viewerMode === 'google'
      ? (lon: number, lat: number): number => {
        const c = lonLatToCell(grid, lon, lat);
        return c ? area.elevation[c.row * grid.width + c.col] : 0;
      }
      : undefined;
    const reference = area.reference ? createReferenceOutline(viewer, area.reference.rings, { groundAt }) : null;
    ctx = { burn, smoke, fuel, slope, outline, reference, painter };
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
    const plan = s.contain.plan;
    const showPlan = !!plan && s.contain.show === 'contained';
    const interventions = showPlan ? [...s.interventions, ...plan.interventions] : s.interventions;
    // Outline of the other run: baseline over the contained run, or the reverse.
    ctx.painter.setRing(plan && s.contain.outline && s.result ? (s.contain.show === 'contained' ? plan.baseline.arrivalTime : plan.contained.arrivalTime) : null);
    const compareMask = s.compare ? s.area?.reference?.mask ?? null : null;
    ctx.painter.schedule(s.result, interventions, s.playback.t, s.settings, preview, compareMask, s.forecast ? ringCellsFor(s.result, s.area?.fuel) : null);
    dispatch.updateTime(s.playback.t);
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
    if (s.contain.plan !== prev.contain.plan || s.area !== prev.area) dispatch.setOrders(s.area?.grid ?? null, s.contain.plan?.orders ?? []);
    if (s.contain !== prev.contain || s.view !== prev.view) dispatch.setVisible(s.view === 'sim' && !!s.contain.plan && s.contain.show === 'contained' && s.contain.units3d);
    if (s.result !== prev.result && s.result && lastScenario && s.contain.plan && (s.result === s.contain.plan.contained || s.result === s.contain.plan.baseline)) attachSmoke(lastScenario, s.result);
    if (s.result !== prev.result || s.playback.t !== prev.playback.t || s.interventions !== prev.interventions || s.settings !== prev.settings || s.contain.show !== prev.contain.show || s.contain.outline !== prev.contain.outline || s.compare !== prev.compare || s.forecast !== prev.forecast) repaint();
    if (s.groundFollow && s.playback.t !== prev.playback.t) followFront(false);
    if (s.tool !== prev.tool) picker.setDragMode(s.tool !== 'ignite');
    if (s.effects !== prev.effects) {
      applyEffects(s);
      effects.setQuality(s.effects.quality);
      ctx.smoke.setVisible(s.effects.smoke && simShown());
      ctx.painter.setEffects({ glow: s.effects.glow, smooth: s.effects.smooth });
      repaint();
    }
  });

  /** Where the fire is burning at playback time: centroid of the recent front, else of the burn, else the ignition. */
  function fireFront(): { lon: number; lat: number; groundM: number } | null {
    const s = store.get();
    if (!s.area) return null;
    const { grid } = s.area;
    const W = grid.width;
    const arr = s.result?.arrivalTime;
    let fr = 0, fc = 0, fn = 0, br = 0, bc = 0, bn = 0;
    if (arr) {
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i];
        if (!(a <= s.playback.t)) continue;
        const r = (i / W) | 0;
        const c = i - r * W;
        br += r; bc += c; bn++;
        if (s.playback.t - a < GROUND_FRONT_WINDOW_S) { fr += r; fc += c; fn++; }
      }
    }
    const cell = fn ? { row: fr / fn, col: fc / fn } : bn ? { row: br / bn, col: bc / bn } : s.ignition;
    if (!cell) return null;
    const row = Math.round(cell.row);
    const col = Math.round(cell.col);
    const { lon, lat } = cellCenterLonLat(grid, row, col);
    const groundM = s.viewerMode === 'google' ? s.area.elevation[row * W + col] : 0;
    return { lon, lat, groundM };
  }

  // Forecast ring cells depend only on the result, so they are computed once per run.
  let ringCache: { result: SimResult; cells: Uint8Array } | null = null;
  function ringCellsFor(result: SimResult | null, fuel: Uint8Array | undefined): Uint8Array | null {
    if (!result || !fuel) return null;
    if (ringCache?.result !== result) ringCache = { result, cells: forecastRingCells(result.arrivalTime, fuel, store.get().area!.grid.width, FORECAST_RINGS) };
    return ringCache.cells;
  }

  let lastFollow = 0;
  function followFront(immediate: boolean): void {
    const now = performance.now();
    if (!immediate && now - lastFollow < GROUND_FOLLOW_INTERVAL_MS) return;
    lastFollow = now;
    const front = fireFront();
    if (!front) return;
    const pose = groundPose(front, front.groundM, windTowardDeg(store.get().weather.windFromDeg));
    flyToGround(viewer, pose, immediate ? 1.8 : GROUND_FOLLOW_INTERVAL_MS / 1000);
  }

  async function selectArea(name: string): Promise<void> {
    const entry = store.get().areas.find((a) => a.name === name);
    if (!entry) {
      notices.show(STR.liveAreaUnavailable, 'info');
      return;
    }
    await loadArea(() => loadDemoArea(entry));
  }

  /** Loads an area and resets everything that belonged to the previous one. */
  async function loadArea(load: () => Promise<DemoArea>): Promise<boolean> {
    store.set({ areaLoading: true, simError: null });
    sim.cancelAll();
    try {
      const area = await load();
      store.set({
        area,
        areaLoading: false,
        ignition: defaultIgnition(area),
        interventions: [],
        result: null,
        baseline: null,
        plan: null,
        compare: false,
        controls: null,
        sideBySide: false,
        groundFollow: false,
        forecast: false,
        resultStale: false,
        simRunning: false,
        playback: { ...store.get().playback, t: 0, playing: false },
        contain: { ...store.get().contain, plan: null, planning: false, show: 'contained' },
        weather: {
          ...store.get().weather,
          windFromDeg: area.meta.defaultWindFromDeg ?? store.get().weather.windFromDeg,
          ...area.meta.defaultWeather,
        },
        durationSeconds: area.meta.defaultDurationSeconds ?? store.get().durationSeconds,
        // Area defaults (e.g. Rothermel on real LANDFIRE fuel), else back to the app's default model.
        settings: { ...store.get().settings, rateModel: DEFAULT_SETTINGS.rateModel, ...area.meta.defaultSettings },
      });
      return true;
    } catch (err) {
      store.set({ areaLoading: false });
      notices.show(`${STR.loadError} ${err instanceof Error ? err.message : String(err)}`, 'error', 8000);
      return false;
    }
  }

  async function loadLiveFires(): Promise<void> {
    store.set({ liveLoading: true });
    try {
      store.set({ liveFires: await fetchLiveFires(), liveLoading: false });
    } catch (err) {
      store.set({ liveLoading: false });
      notices.show(`${STR.liveFiresError} ${err instanceof Error ? err.message : String(err)}`, 'error', 8000);
    }
  }

  /** Builds the forest around a fire burning now and forecasts the next hours from its reported point. */
  async function predictLiveFire(fire: LiveFire): Promise<void> {
    notices.persistent('live', `${STR.liveBuilding} ${fire.name}…`, 'info');
    const ok = await loadArea(() => buildLiveArea(fire));
    notices.persistent('live', null);
    if (!ok) return;
    await simulate();
    if (!store.get().result) return;
    store.set({ forecast: true, playback: { t: 0, playing: true, speed: LIVE_FORECAST_SPEED } });
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

  /** Smoke follows the scenario that produced the result, not the live (possibly edited) weather. */
  function attachSmoke(scenario: Scenario, result: SimResult): void {
    if (!ctx) return;
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

  async function simulate(): Promise<void> {
    const scenario = buildScenario();
    if (typeof scenario === 'string') {
      store.set({ simError: scenario });
      return;
    }
    const s0 = store.get();
    const respond = s0.contain.enabled;
    store.set({ simRunning: true, simError: null, controls: null, contain: { ...s0.contain, planning: respond, progress: 0 } });
    try {
      let plan: ContainPlan | null = null;
      let result: SimResult;
      if (respond) {
        let lastShown = 0;
        plan = await sim.plan(
          { scenario, level: s0.contain.level, overrides: s0.contain.overrides, homes: s0.area?.homes ?? null },
          (f) => {
            if (f - lastShown < 0.05 && f < 1) return;
            lastShown = f;
            store.update((st) => ({ contain: { ...st.contain, progress: f } }));
          },
        );
        result = plan.contained;
      } else {
        result = await sim.run(scenario);
      }
      lastScenario = scenario;
      attachSmoke(scenario, result);
      // The same scenario without any firefighting, so the panel can say what the actions changed
      // ("homes reached: before -> after"). The response plan already carries its own baseline.
      const baseline = plan ? plan.baseline : scenario.interventions.length ? runSimulation({ ...scenario, interventions: [] }) : result;
      const s = store.get();
      const firstRun = !s.result;
      const t = Math.min(s.playback.t, s.durationSeconds);
      store.set({
        result,
        baseline,
        resultStale: false,
        simRunning: false,
        playback: { ...s.playback, t: firstRun ? 0 : t, playing: firstRun ? true : s.playback.playing },
        contain: { ...s.contain, plan, planning: false, progress: 1, show: 'contained' },
      });
    } catch (err) {
      store.update((st) => ({ contain: { ...st.contain, planning: false } }));
      if (err instanceof SimCancelledError) return;
      store.set({ simRunning: false, simError: `${STR.simFailed} ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  /** Runs the area's real fire: recorded weather and ignition, no firefighting actions. */
  async function runRealFire(): Promise<{ result: SimResult; grid: GridSpec; fairT: number | null } | null> {
    const s = store.get();
    const ref = s.area?.reference;
    if (!s.area || !ref) return null;
    store.set({
      weather: { ...s.weather, windFromDeg: s.area.meta.defaultWindFromDeg ?? s.weather.windFromDeg, ...s.area.meta.defaultWeather },
      settings: { ...s.settings, ...s.area.meta.defaultSettings },
      ignition: defaultIgnition(s.area),
      interventions: [],
      plan: null,
      // The real fire had the response it had; the comparison is of the spread model alone.
      contain: { ...s.contain, enabled: false, plan: null, show: 'contained' },
    });
    await simulate();
    const after = store.get();
    const scenario = buildScenario();
    if (!after.result || !after.area || typeof scenario === 'string') return null;
    store.set({ controls: controlRuns(scenario, ref) });
    const fair = overlapAtRealSize(after.result, ref);
    return { result: after.result, grid: after.area.grid, fairT: fair ? fair.t : null };
  }

  async function compareWithRealFire(): Promise<void> {
    const run = await runRealFire();
    if (!run) return;
    // Jump to the moment the run is as big as the real fire: the fair point to compare shapes.
    const s = store.get();
    store.set({ compare: true, groundFollow: false, playback: { ...s.playback, playing: false, t: run.fairT ?? s.durationSeconds } });
    flyTopDown(viewer, run.grid);
  }

  async function realVsSim(): Promise<void> {
    const run = await runRealFire();
    if (!run) return;
    // Play from ignition so the right-hand map grows live; the card pauses itself at real size.
    store.set({ sideBySide: true, compare: false, groundFollow: false, playback: { t: 0, playing: true, speed: REAL_VS_SIM_SPEED } });
    flyTopDown(viewer, run.grid);
  }

  return {
    selectArea,
    loadLiveFires,
    predictLiveFire,
    simulate,
    compareWithRealFire,
    realVsSim,
    buildScenario,
    cancel: () => {
      sim.cancelAll();
      store.set({ simRunning: false });
    },
    topDown: () => {
      const g = store.get().area?.grid;
      store.set({ groundFollow: false });
      if (g) flyTopDown(viewer, g);
    },
    resetView: () => {
      const g = store.get().area?.grid;
      store.set({ groundFollow: false });
      if (g) flyToGrid(viewer, g);
    },
    groundView: () => {
      const on = !store.get().groundFollow;
      store.set({ groundFollow: on });
      if (on) followFront(true);
      else {
        const g = store.get().area?.grid;
        if (g) flyToGrid(viewer, g);
      }
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
