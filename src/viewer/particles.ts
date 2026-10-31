/**
 * Flame and smoke particle effects on the active fire front. Capped number of emitters sampled
 * from cells that ignited recently; smoke drifts downwind. Behind a toggle with a quality setting.
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
/** Cells that ignited within this many simulated seconds count as "front". */
const FRONT_WINDOW_S = 900;
const UPDATE_INTERVAL_MS = 250;

export interface FireEffectsUpdate {
  grid: GridSpec;
  arrival: Float32Array | null;
  elevation: Float32Array;
  t: number;
  /** Downwind unit vector (x east, y north) and speed in m/s. */
  windX: number;
  windY: number;
  windSpeedMps: number;
  /** Byram flame length per cell (m). Scales each flame emitter; null uses a default size. */
  flameLengthM?: Float32Array | null;
  /** Heights: on the fallback ellipsoid everything sits at 0; with 3D tiles use the elevation grid. */
  useElevation: boolean;
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
}

export function createFireEffects(viewer: Viewer): FireEffects {
  const sprite = makeSprite();
  const emitters: Emitter[] = [];
  let enabled = true;
  let quality: EffectQuality = 'medium';
  let lastUpdate = 0;
  let wind = new Cartesian3(0, 0, 0);
  const scratch = new Cartesian3();

  const smokeUpdate = (p: Particle, dt: number): void => {
    // Drift with the wind and rise, slowing as it ages.
    Cartesian3.multiplyByScalar(wind, dt, scratch);
    Cartesian3.add(p.velocity, scratch, p.velocity);
    p.velocity.z = Math.max(1.5, p.velocity.z - 0.6 * dt);
  };

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
    const smoke = viewer.scene.primitives.add(
      new ParticleSystem({
        image: sprite,
        startColor: new Color(0.35, 0.33, 0.32, 0.45),
        endColor: new Color(0.5, 0.5, 0.5, 0),
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
        updateCallback: smokeUpdate,
      }),
    ) as ParticleSystem;
    return { flame, smoke, cell: -1 };
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

  return {
    update(u) {
      if (!enabled || !u.arrival) {
        hideAll();
        return;
      }
      const now = performance.now();
      if (now - lastUpdate < UPDATE_INTERVAL_MS) return;
      lastUpdate = now;
      const speed = Math.max(0, u.windSpeedMps);
      wind = new Cartesian3(u.windX * speed * 0.6, u.windY * speed * 0.6, 0);
      ensureCount(EMITTERS[quality]);

      // Candidate front cells: ignited within the window. Stable hash-based subsampling so emitters
      // do not jump around between updates.
      const arr = u.arrival;
      const lo = u.t - FRONT_WINDOW_S;
      let candidates = 0;
      for (let i = 0; i < arr.length; i++) if (arr[i] !== NEVER_ARRIVES && arr[i] <= u.t && arr[i] > lo) candidates++;
      const keep = candidates === 0 ? 0 : Math.min(1, emitters.length / candidates);
      let k = 0;
      for (let i = 0; i < arr.length && k < emitters.length; i++) {
        if (!(arr[i] !== NEVER_ARRIVES && arr[i] <= u.t && arr[i] > lo)) continue;
        const h = (Math.imul(i, 2654435761) >>> 0) / 4294967296;
        if (h > keep) continue;
        const e = emitters[k++];
        const len = u.flameLengthM ? u.flameLengthM[i] : 0;
        if (e.cell !== i) {
          e.cell = i;
          sizeFlame(e.flame, len);
          const row = (i / u.grid.width) | 0;
          const col = i - row * u.grid.width;
          const { lon, lat } = cellCenterLonLat(u.grid, row, col);
          const height = u.useElevation ? u.elevation[i] : 0;
          const m = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(lon, lat, height));
          e.flame.modelMatrix = Matrix4.clone(m, e.flame.modelMatrix);
          e.smoke.modelMatrix = Matrix4.clone(m, e.smoke.modelMatrix);
        }
        e.flame.show = true;
        e.smoke.show = true;
      }
      for (; k < emitters.length; k++) {
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

// TODO(3d-polish): additive-blended glow sprite, heat shimmer, ember sparks, LOD by camera
// distance, and real surface heights on 3D tiles (scene.sampleHeight) instead of the elevation grid.
/** Flame particles span roughly the flame length: size and rise speed follow Byram's L. */
function sizeFlame(flame: ParticleSystem, lengthM: number): void {
  const L = Math.min(30, Math.max(1.5, lengthM || 3));
  const size = new Cartesian2(Math.max(5, L * 0.8), Math.max(7, L * 1.2));
  flame.minimumImageSize = size;
  flame.maximumImageSize = size;
  flame.minimumSpeed = L * 0.5;
  flame.maximumSpeed = L * 1.1;
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
