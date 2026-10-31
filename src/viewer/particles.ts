/**
 * Flame and smoke particle effects on the fire. Flames sit on cells that are flaming (per-fuel
 * burnout); smoke emitters sit on flaming and smoldering cells and are driven by the smoke field
 * (src/app/smoke): emission weight sets the rate, the plume top sets the initial rise, and each
 * particle follows buoyancy decay, a wind profile and deterministic hash turbulence. Without the
 * smoke feed the pre-D20 behaviour applies. Behind a toggle with a quality setting.
 */

import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  CircleEmitter,
  Color,
  Matrix4,
  ParticleSystem,
  Transforms,
} from 'cesium';
import type { Particle, Viewer } from 'cesium';
import type { GridSpec } from '../contract';
import { FUELS, FuelClass, NEVER_ARRIVES, isBurnable } from '../contract';
import { cellCenterLonLat } from '../data/geo';

export type EffectQuality = 'low' | 'medium' | 'high';

const EMITTERS: Record<EffectQuality, number> = { low: 20, medium: 45, high: 80 };
/** Live smoke particles allowed per emitter (rate x life is capped to this). */
const PARTICLE_CAP: Record<EffectQuality, number> = { low: 30, medium: 50, high: 70 };
/** Cells that ignited within this many simulated seconds count as "front" when no smoke feed exists. */
const FRONT_WINDOW_S = 900;
const UPDATE_INTERVAL_MS = 250;
/** Smoke emitters only where the field emission is above this share of the strongest source. */
const EMISSION_FLOOR = 0.05;

export interface EffectFlags {
  flames: boolean;
  embers: boolean;
  smokeParticles: boolean;
}

export interface SmokeFeed {
  /** Per-cell emission of the last field step. */
  emission: Float32Array;
  /** Emission of the strongest flaming cell per step. */
  refEmission: number;
  burnoutAt: Float32Array;
  plumeTopM: number;
  smolderFrac: number;
}

export interface FireEffectsUpdate {
  grid: GridSpec;
  arrival: Float32Array | null;
  elevation: Float32Array;
  t: number;
  /** Downwind unit vector (x east, y north) and speed in m/s. */
  windX: number;
  windY: number;
  windSpeedMps: number;
  /** Heights: on the fallback ellipsoid everything sits at 0; with 3D tiles use the elevation grid. */
  useElevation: boolean;
  /** Simulated seconds per real second (fast playback shortens smoke particle life). */
  playbackSpeed?: number;
  /** Smoke field feed; null keeps the legacy behaviour. */
  smoke?: SmokeFeed | null;
  /** Fuel per cell and the sim's relative spread rate, for Byram flame length. */
  fuel?: Uint8Array;
  intensity?: Float32Array | null;
  maxRateMps?: number;
}

export interface FireEffects {
  update(u: FireEffectsUpdate): void;
  setFlags(flags: EffectFlags): void;
  setQuality(q: EffectQuality): void;
  destroy(): void;
}

interface Emitter {
  flame: ParticleSystem;
  smoke: ParticleSystem;
  ember: ParticleSystem;
  cell: number;
  /** Visual flame height, m. */
  flameH: number;
  /** Initial vertical speed of smoke, m/s (from the local plume rise). */
  w0: number;
  /** Local ENU axes in world (ECEF) coordinates, refreshed when the emitter moves. */
  origin: Cartesian3;
  east: Cartesian3;
  north: Cartesian3;
  up: Cartesian3;
}

/** Byram: I = H w R (kW/m), L = 0.0775 I^0.46 (m). Visual height exaggerates L for 30 m cells. */
function flameHeightM(fuel: number, rateMps: number): number {
  if (!isBurnable(fuel)) return 3;
  const spec = FUELS[fuel as FuelClass];
  const I = (spec.bed.heatContentJkg / 1000) * spec.bed.loadKgM2 * Math.max(0.005, rateMps);
  const L = 0.0775 * Math.pow(I, 0.46);
  return Math.min(16, Math.max(3, L * 4));
}

const EMBER_START = new Color(1.0, 0.78, 0.35, 1.0);
const EMBER_END = new Color(0.55, 0.08, 0.0, 0.0);
const SMOKE_FLAMING = new Color(0.45, 0.43, 0.41, 0.32);
const SMOKE_SMOLDER = new Color(0.78, 0.78, 0.82, 0.22);
const SMOKE_END = new Color(0.55, 0.55, 0.57, 0);

export function createFireEffects(viewer: Viewer): FireEffects {
  const sprite = makeSprite();
  const flameSprite = makeFlameSprite();
  const emberSprite = makeEmberSprite();
  const emitters: Emitter[] = [];
  let flags: EffectFlags = { flames: true, embers: true, smokeParticles: true };
  let quality: EffectQuality = 'medium';
  let lastUpdate = 0;
  // Wind in ENU (x east, y north), m/s at 10 m.
  let windE = 0;
  let windN = 0;
  let wind10 = 0;
  const vTmp = new Cartesian3();

  function makeEmitter(): Emitter {
    const e: Emitter = {
      flame: null as unknown as ParticleSystem,
      smoke: null as unknown as ParticleSystem,
      ember: null as unknown as ParticleSystem,
      cell: -1,
      flameH: 6,
      w0: 3,
      origin: new Cartesian3(),
      east: new Cartesian3(1, 0, 0),
      north: new Cartesian3(0, 1, 0),
      up: new Cartesian3(0, 0, 1),
    };
    e.flame = viewer.scene.primitives.add(
      new ParticleSystem({
        image: flameSprite,
        startColor: new Color(1, 0.98, 0.75, 0.95),
        endColor: new Color(1, 0.25, 0.0, 0),
        startScale: 1,
        endScale: 0.35,
        minimumParticleLife: 0.5,
        maximumParticleLife: 1.0,
        minimumSpeed: 5,
        maximumSpeed: 10,
        imageSize: new Cartesian2(3, 6),
        sizeInMeters: true,
        emissionRate: 14,
        emitter: new CircleEmitter(10),
        lifetime: 16,
        loop: true,
        show: false,
        updateCallback: (p: Particle, dt: number) => flameUpdate(e, p, dt),
      }),
    ) as ParticleSystem;
    e.ember = viewer.scene.primitives.add(
      new ParticleSystem({
        image: emberSprite,
        startColor: EMBER_START,
        endColor: EMBER_END,
        startScale: 1,
        endScale: 0.5,
        minimumParticleLife: 3,
        maximumParticleLife: 6,
        minimumSpeed: 5,
        maximumSpeed: 11,
        imageSize: new Cartesian2(0.9, 0.9),
        sizeInMeters: true,
        emissionRate: 1,
        emitter: new CircleEmitter(8),
        lifetime: 16,
        loop: true,
        show: false,
        updateCallback: (p: Particle, dt: number) => emberUpdate(e, p, dt),
      }),
    ) as ParticleSystem;
    e.smoke = viewer.scene.primitives.add(
      new ParticleSystem({
        image: sprite,
        startColor: SMOKE_FLAMING,
        endColor: SMOKE_END,
        startScale: 0.6,
        endScale: 3.2,
        minimumParticleLife: 6,
        maximumParticleLife: 12,
        minimumSpeed: 3,
        maximumSpeed: 7,
        imageSize: new Cartesian2(16, 16),
        sizeInMeters: true,
        emissionRate: 4,
        emitter: new CircleEmitter(14),
        lifetime: 16,
        loop: true,
        show: false,
        updateCallback: (p: Particle, dt: number) => smokeUpdate(e, p, dt),
      }),
    ) as ParticleSystem;
    return e;
  }

  /** Flames lean downwind and flicker; they never travel far. */
  function flameUpdate(e: Emitter, p: Particle, dt: number): void {
    if (dt <= 0 || quality === 'low') return;
    const lean = 0.35 * dt;
    Cartesian3.multiplyByScalar(e.east, windE * lean, vTmp);
    Cartesian3.add(p.velocity, vTmp, p.velocity);
    Cartesian3.multiplyByScalar(e.north, windN * lean, vTmp);
    Cartesian3.add(p.velocity, vTmp, p.velocity);
    const h = hash3(p.position.x, p.position.z, p.age);
    const jitter = 1.2 * Math.sqrt(dt);
    Cartesian3.multiplyByScalar(e.east, (h[0] - 0.5) * jitter, vTmp);
    Cartesian3.add(p.velocity, vTmp, p.velocity);
    Cartesian3.multiplyByScalar(e.north, (h[1] - 0.5) * jitter, vTmp);
    Cartesian3.add(p.velocity, vTmp, p.velocity);
  }

  /** Embers: lofted by the plume, pulled down by gravity, carried and scattered by the wind. */
  function emberUpdate(e: Emitter, p: Particle, dt: number): void {
    if (dt <= 0) return;
    const v = p.velocity;
    Cartesian3.subtract(p.position, e.origin, vTmp);
    const z = Cartesian3.dot(vTmp, e.up);
    const vz = Cartesian3.dot(v, e.up);
    // Buoyant while young, then gravity (drag-limited fall of a glowing fragment).
    const loft = p.normalizedAge < 0.3 ? 4 : -2.5;
    const dvz = Math.max(-6 - vz, loft * dt);
    const shear = Math.pow(Math.max(z, 10) / 10, 0.15);
    const ve = Cartesian3.dot(v, e.east);
    const vn = Cartesian3.dot(v, e.north);
    const relax = Math.min(1, dt / 1.2);
    const h = hash3(p.position.y, p.position.x, p.age);
    const amp = (1.0 + 0.4 * wind10) * Math.sqrt(dt);
    const dve = (windE * shear * 1.1 - ve) * relax + (h[0] - 0.5) * amp;
    const dvn = (windN * shear * 1.1 - vn) * relax + (h[1] - 0.5) * amp;
    Cartesian3.multiplyByScalar(e.east, dve, vTmp);
    Cartesian3.add(v, vTmp, v);
    Cartesian3.multiplyByScalar(e.north, dvn, vTmp);
    Cartesian3.add(v, vTmp, v);
    Cartesian3.multiplyByScalar(e.up, dvz, vTmp);
    Cartesian3.add(v, vTmp, v);
  }

  /** Per-particle physics in world coordinates using the emitter's local ENU axes. */
  function smokeUpdate(e: Emitter, p: Particle, dt: number): void {
    if (dt <= 0) return;
    const v = p.velocity;
    const vz = Cartesian3.dot(v, e.up);
    if (quality === 'low') {
      // Cheap: constant wind push and a rise floor.
      Cartesian3.multiplyByScalar(e.east, windE * 0.6 * dt, vTmp);
      Cartesian3.add(v, vTmp, v);
      Cartesian3.multiplyByScalar(e.north, windN * 0.6 * dt, vTmp);
      Cartesian3.add(v, vTmp, v);
      if (vz < 1.5) {
        Cartesian3.multiplyByScalar(e.up, 1.5 - vz, vTmp);
        Cartesian3.add(v, vTmp, v);
      }
      return;
    }
    // Height above the emitter.
    Cartesian3.subtract(p.position, e.origin, vTmp);
    const z = Cartesian3.dot(vTmp, e.up);
    // Buoyancy: rise speed decays with age toward a small residual.
    const target = Math.max(0.3, e.w0 * Math.exp(-3 * p.normalizedAge));
    const dvz = (target - vz) * Math.min(1, dt / 1.5);
    // Wind shear: horizontal speed follows a power-law profile referenced to 10 m.
    const shear = Math.pow(Math.max(z, 10) / 10, 0.15);
    const ve = Cartesian3.dot(v, e.east);
    const vn = Cartesian3.dot(v, e.north);
    const relax = Math.min(1, dt / 2);
    let dve = (windE * shear - ve) * relax;
    let dvn = (windN * shear - vn) * relax;
    // Deterministic turbulence from the particle's own state (no Math.random).
    const h = hash3(p.position.x, p.position.y, p.age);
    const amp = (0.5 + 0.3 * wind10) * Math.sqrt(dt);
    dve += (h[0] - 0.5) * amp;
    dvn += (h[1] - 0.5) * amp;
    Cartesian3.multiplyByScalar(e.east, dve, vTmp);
    Cartesian3.add(v, vTmp, v);
    Cartesian3.multiplyByScalar(e.north, dvn, vTmp);
    Cartesian3.add(v, vTmp, v);
    Cartesian3.multiplyByScalar(e.up, dvz, vTmp);
    Cartesian3.add(v, vTmp, v);
  }

  function place(e: Emitter, u: FireEffectsUpdate, i: number): void {
    e.cell = i;
    const row = (i / u.grid.width) | 0;
    const col = i - row * u.grid.width;
    const { lon, lat } = cellCenterLonLat(u.grid, row, col);
    const height = surfaceHeight(lon, lat, u.useElevation ? u.elevation[i] : 0);
    const m = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(lon, lat, height));
    e.flame.modelMatrix = Matrix4.clone(m, e.flame.modelMatrix);
    e.smoke.modelMatrix = Matrix4.clone(m, e.smoke.modelMatrix);
    e.ember.modelMatrix = Matrix4.clone(m, e.ember.modelMatrix);
    Matrix4.getTranslation(m, e.origin);
    Matrix4.multiplyByPointAsVector(m, Cartesian3.UNIT_X, e.east);
    Matrix4.multiplyByPointAsVector(m, Cartesian3.UNIT_Y, e.north);
    Matrix4.multiplyByPointAsVector(m, Cartesian3.UNIT_Z, e.up);
  }

  /**
   * Height of the rendered surface (3D tiles or globe) at a point, falling back to `fallback`.
   * The elevation grid is orthometric while tiles are ellipsoidal (geoid offset tens of metres),
   * so emitters placed from the grid alone can end up under the tiles (D14).
   */
  const cartoScratch = new Cartographic();
  function surfaceHeight(lon: number, lat: number, fallback: number): number {
    const scene = viewer.scene;
    if (!scene.sampleHeightSupported) return fallback;
    const h = scene.sampleHeight(Cartographic.fromDegrees(lon, lat, 0, cartoScratch));
    return Number.isFinite(h) ? (h as number) : fallback;
  }

  function configureSmoke(e: Emitter, feed: SmokeFeed, i: number, speed: number): void {
    const w = feed.emission[i] / feed.refEmission;
    e.w0 = Math.min(12, Math.max(2, 2 + feed.plumeTopM / 100));
    let life = Math.min(24, Math.max(6, (feed.plumeTopM / e.w0) * 0.5));
    if (speed >= 64) life *= 0.5;
    let rate = Math.min(6, Math.max(0.8, 1 + 5 * Math.sqrt(Math.max(0, w))));
    rate = Math.min(rate, PARTICLE_CAP[quality] / life);
    e.smoke.emissionRate = rate;
    e.smoke.minimumParticleLife = life * 0.5;
    e.smoke.maximumParticleLife = life;
    e.smoke.minimumSpeed = e.w0 * 0.6;
    e.smoke.maximumSpeed = e.w0 * 1.2;
    e.smoke.startColor = Color.lerp(SMOKE_FLAMING, SMOKE_SMOLDER, Math.min(1, Math.max(0, feed.smolderFrac)), new Color());
  }

  /** Flame size and rate from the local flame length; embers scale with it. */
  function configureFlame(e: Emitter, u: FireEffectsUpdate, i: number, w: number): void {
    const rate = (u.intensity ? u.intensity[i] : 0.5) * (u.maxRateMps ?? 0);
    const h = flameHeightM(u.fuel ? u.fuel[i] : FuelClass.GRASS, rate);
    if (Math.abs(h - e.flameH) > 0.5) {
      e.flameH = h;
      e.flame.minimumImageSize = new Cartesian2(h * 0.42, h * 0.85);
      e.flame.maximumImageSize = new Cartesian2(h * 0.58, h * 1.15);
      e.flame.minimumSpeed = h * 0.9;
      e.flame.maximumSpeed = h * 1.8;
      e.ember.minimumSpeed = 4 + h * 0.4;
      e.ember.maximumSpeed = 8 + h * 0.8;
    }
    const vigour = Math.min(1.5, Math.max(0.3, w));
    e.flame.emissionRate = Math.min(PARTICLE_CAP[quality] / 1.0, 10 + 12 * vigour);
    e.ember.emissionRate = Math.min(PARTICLE_CAP[quality] / 8, 0.4 + 1.6 * vigour);
  }

  function ensureCount(n: number): void {
    while (emitters.length < n) emitters.push(makeEmitter());
    while (emitters.length > n) {
      const e = emitters.pop()!;
      viewer.scene.primitives.remove(e.flame);
      viewer.scene.primitives.remove(e.smoke);
      viewer.scene.primitives.remove(e.ember);
    }
  }

  function hideAll(): void {
    for (const e of emitters) {
      e.flame.show = false;
      e.smoke.show = false;
      e.ember.show = false;
      e.cell = -1;
    }
  }

  /** Stable per-cell hash in [0, 1) so emitters do not jump between updates. */
  const cellHash = (i: number): number => (Math.imul(i, 2654435761) >>> 0) / 4294967296;

  return {
    update(u) {
      const any = flags.flames || flags.embers || flags.smokeParticles;
      if (!any || !u.arrival) {
        hideAll();
        return;
      }
      const now = performance.now();
      if (now - lastUpdate < UPDATE_INTERVAL_MS) return;
      lastUpdate = now;
      wind10 = Math.max(0, u.windSpeedMps);
      windE = u.windX * wind10;
      windN = u.windY * wind10;
      ensureCount(EMITTERS[quality]);
      const speed = u.playbackSpeed ?? 1;

      const arr = u.arrival;
      const feed = u.smoke ?? null;
      const n = arr.length;
      const isFlaming = (i: number): boolean => {
        const a = arr[i];
        if (a === NEVER_ARRIVES || a > u.t) return false;
        return feed ? u.t < feed.burnoutAt[i] : a > u.t - FRONT_WINDOW_S;
      };
      const isSmoldering = (i: number): boolean => !!feed && feed.emission[i] > EMISSION_FLOOR * feed.refEmission && !isFlaming(i);

      // Pass 1: flaming cells (flames + smoke). Pass 2: smoldering cells (smoke only).
      let flaming = 0;
      let smoldering = 0;
      for (let i = 0; i < n; i++) {
        if (isFlaming(i)) flaming++;
        else if (feed && isSmoldering(i)) smoldering++;
      }
      const cap = emitters.length;
      const keepFlame = flaming === 0 ? 0 : Math.min(1, cap / flaming);
      const left = Math.max(0, cap - Math.min(cap, flaming));
      const keepSmolder = smoldering === 0 ? 0 : Math.min(1, left / smoldering);
      let k = 0;
      for (let pass = 0; pass < 2 && k < cap; pass++) {
        const keep = pass === 0 ? keepFlame : keepSmolder;
        if (keep === 0) continue;
        for (let i = 0; i < n && k < cap; i++) {
          const match = pass === 0 ? isFlaming(i) : isSmoldering(i);
          if (!match || cellHash(i) > keep) continue;
          const e = emitters[k++];
          if (e.cell !== i) place(e, u, i);
          const w = feed ? feed.emission[i] / feed.refEmission : 1;
          if (feed) configureSmoke(e, feed, i, speed);
          if (pass === 0) configureFlame(e, u, i, w);
          e.flame.show = flags.flames && pass === 0;
          e.ember.show = flags.embers && pass === 0;
          e.smoke.show = flags.smokeParticles;
        }
      }
      for (; k < cap; k++) {
        emitters[k].flame.show = false;
        emitters[k].smoke.show = false;
        emitters[k].ember.show = false;
        emitters[k].cell = -1;
      }
    },
    setFlags(f) {
      flags = { ...f };
      lastUpdate = 0;
      if (!(f.flames || f.embers || f.smokeParticles)) hideAll();
    },
    setQuality(q) {
      quality = q;
      lastUpdate = 0;
    },
    destroy() {
      ensureCount(0);
    },
  };
}

// ---- deterministic hash ----
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
function bits(x: number): number {
  f32[0] = x;
  return u32[0];
}
function rotl(x: number, r: number): number {
  return ((x << r) | (x >>> (32 - r))) >>> 0;
}
const hashOut: [number, number] = [0, 0];
function hash3(x: number, y: number, z: number): [number, number] {
  let h = (bits(x) ^ rotl(bits(y), 13) ^ rotl(bits(z), 7)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h ^= h >>> 16;
  hashOut[0] = (h >>> 0) / 4294967296;
  hashOut[1] = (Math.imul(h, 2654435761) >>> 0) / 4294967296;
  return hashOut;
}

// TODO(3d-polish): additive-blended glow sprite, heat shimmer, ember sparks, LOD by camera
// distance, and real surface heights on 3D tiles (scene.sampleHeight) instead of the elevation grid.
/** Tall teardrop flame: white-yellow core, orange body, soft edge. */
function makeFlameSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 44, 2, 16, 36, 30);
  g.addColorStop(0, 'rgba(255,255,235,1)');
  g.addColorStop(0.25, 'rgba(255,230,120,0.95)');
  g.addColorStop(0.55, 'rgba(255,140,30,0.75)');
  g.addColorStop(0.85, 'rgba(255,60,0,0.25)');
  g.addColorStop(1, 'rgba(255,40,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(16, 0);
  ctx.bezierCurveTo(30, 24, 32, 44, 16, 64);
  ctx.bezierCurveTo(0, 44, 2, 24, 16, 0);
  ctx.closePath();
  ctx.fill();
  return c;
}

/** Small hot speck for embers. */
function makeEmberSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
  g.addColorStop(0, 'rgba(255,255,220,1)');
  g.addColorStop(0.4, 'rgba(255,190,80,0.9)');
  g.addColorStop(1, 'rgba(255,120,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 16);
  return c;
}

function makeSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return c;
}
