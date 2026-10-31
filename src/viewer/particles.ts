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
  CircleEmitter,
  Color,
  Matrix4,
  ParticleSystem,
  Transforms,
} from 'cesium';
import type { Particle, Viewer } from 'cesium';
import type { GridSpec } from '../contract';
import { NEVER_ARRIVES } from '../contract';
import { cellCenterLonLat } from '../data/geo';

export type EffectQuality = 'low' | 'medium' | 'high';

const EMITTERS: Record<EffectQuality, number> = { low: 20, medium: 45, high: 80 };
/** Live smoke particles allowed per emitter (rate x life is capped to this). */
const PARTICLE_CAP: Record<EffectQuality, number> = { low: 40, medium: 80, high: 100 };
/** Cells that ignited within this many simulated seconds count as "front" when no smoke feed exists. */
const FRONT_WINDOW_S = 900;
const UPDATE_INTERVAL_MS = 250;
/** Smoke emitters only where the field emission is above this share of the strongest source. */
const EMISSION_FLOOR = 0.05;

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
}

export interface FireEffects {
  update(u: FireEffectsUpdate): void;
  setEnabled(enabled: boolean): void;
  setQuality(q: EffectQuality): void;
  destroy(): void;
}

interface Emitter {
  flame: ParticleSystem;
  smoke: ParticleSystem;
  cell: number;
  /** Initial vertical speed of smoke, m/s (from the local plume rise). */
  w0: number;
  /** Local ENU axes in world (ECEF) coordinates, refreshed when the emitter moves. */
  origin: Cartesian3;
  east: Cartesian3;
  north: Cartesian3;
  up: Cartesian3;
}

const SMOKE_FLAMING = new Color(0.45, 0.43, 0.41, 0.5);
const SMOKE_SMOLDER = new Color(0.78, 0.78, 0.82, 0.35);
const SMOKE_END = new Color(0.55, 0.55, 0.57, 0);

export function createFireEffects(viewer: Viewer): FireEffects {
  const sprite = makeSprite();
  const emitters: Emitter[] = [];
  let enabled = true;
  let quality: EffectQuality = 'medium';
  let lastUpdate = 0;
  // Wind in ENU (x east, y north), m/s at 10 m.
  let windE = 0;
  let windN = 0;
  let wind10 = 0;
  const vTmp = new Cartesian3();

  function makeEmitter(): Emitter {
    const flame = viewer.scene.primitives.add(
      new ParticleSystem({
        image: sprite,
        startColor: Color.fromCssColorString('#fff2a8').withAlpha(0.9),
        endColor: Color.fromCssColorString('#ff4a00').withAlpha(0),
        startScale: 1,
        endScale: 0.3,
        minimumParticleLife: 0.8,
        maximumParticleLife: 1.6,
        minimumSpeed: 4,
        maximumSpeed: 10,
        imageSize: new Cartesian2(18, 26),
        sizeInMeters: true,
        emissionRate: 12,
        emitter: new CircleEmitter(12),
        lifetime: 16,
        loop: true,
        show: false,
      }),
    ) as ParticleSystem;
    const e: Emitter = {
      flame,
      smoke: null as unknown as ParticleSystem,
      cell: -1,
      w0: 3,
      origin: new Cartesian3(),
      east: new Cartesian3(1, 0, 0),
      north: new Cartesian3(0, 1, 0),
      up: new Cartesian3(0, 0, 1),
    };
    e.smoke = viewer.scene.primitives.add(
      new ParticleSystem({
        image: sprite,
        startColor: SMOKE_FLAMING,
        endColor: SMOKE_END,
        startScale: 1,
        endScale: 5,
        minimumParticleLife: 6,
        maximumParticleLife: 12,
        minimumSpeed: 3,
        maximumSpeed: 7,
        imageSize: new Cartesian2(22, 22),
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
    const height = u.useElevation ? u.elevation[i] : 0;
    const m = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(lon, lat, height));
    e.flame.modelMatrix = Matrix4.clone(m, e.flame.modelMatrix);
    e.smoke.modelMatrix = Matrix4.clone(m, e.smoke.modelMatrix);
    Matrix4.getTranslation(m, e.origin);
    Matrix4.multiplyByPointAsVector(m, Cartesian3.UNIT_X, e.east);
    Matrix4.multiplyByPointAsVector(m, Cartesian3.UNIT_Y, e.north);
    Matrix4.multiplyByPointAsVector(m, Cartesian3.UNIT_Z, e.up);
  }

  function configureSmoke(e: Emitter, feed: SmokeFeed, i: number, speed: number): void {
    const w = feed.emission[i] / feed.refEmission;
    e.w0 = Math.min(12, Math.max(2, 2 + feed.plumeTopM / 100));
    let life = Math.min(24, Math.max(6, (feed.plumeTopM / e.w0) * 0.5));
    if (speed >= 64) life *= 0.5;
    let rate = Math.min(10, Math.max(1, 2 + 8 * Math.sqrt(Math.max(0, w))));
    rate = Math.min(rate, PARTICLE_CAP[quality] / life);
    e.smoke.emissionRate = rate;
    e.smoke.minimumParticleLife = life * 0.5;
    e.smoke.maximumParticleLife = life;
    e.smoke.minimumSpeed = e.w0 * 0.6;
    e.smoke.maximumSpeed = e.w0 * 1.2;
    e.smoke.startColor = Color.lerp(SMOKE_FLAMING, SMOKE_SMOLDER, Math.min(1, Math.max(0, feed.smolderFrac)), new Color());
  }

  function ensureCount(n: number): void {
    while (emitters.length < n) emitters.push(makeEmitter());
    while (emitters.length > n) {
      const e = emitters.pop()!;
      viewer.scene.primitives.remove(e.flame);
      viewer.scene.primitives.remove(e.smoke);
    }
  }

  function hideAll(): void {
    for (const e of emitters) {
      e.flame.show = false;
      e.smoke.show = false;
      e.cell = -1;
    }
  }

  /** Stable per-cell hash in [0, 1) so emitters do not jump between updates. */
  const cellHash = (i: number): number => (Math.imul(i, 2654435761) >>> 0) / 4294967296;

  return {
    update(u) {
      if (!enabled || !u.arrival) {
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
          if (feed) configureSmoke(e, feed, i, speed);
          e.flame.show = pass === 0;
          e.smoke.show = true;
        }
      }
      for (; k < cap; k++) {
        emitters[k].flame.show = false;
        emitters[k].smoke.show = false;
        emitters[k].cell = -1;
      }
    },
    setEnabled(v) {
      enabled = v;
      if (!v) hideAll();
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
