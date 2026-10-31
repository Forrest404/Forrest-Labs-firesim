/**
 * Turning and tilting the view about whatever is at the centre of the screen, so the scene stays put
 * while the camera swings around it (like dragging a globe), instead of spinning on the spot.
 * If nothing is under the centre (looking at the sky) it falls back to turning in place.
 */

import { Cartesian2, Cartesian3, HeadingPitchRange, Math as CesiumMath, Matrix4, Transforms } from 'cesium';
import type { Viewer } from 'cesium';
import { MIN_FLIGHT_HEIGHT_M, clamp, easeInOut, normalizeDeg, shortestDeltaDeg } from './cameraMath';

const centre = new Cartesian2();

/** The point on the ground (or 3D tiles) at the screen centre, if any. */
export function screenCentreTarget(viewer: Viewer): Cartesian3 | undefined {
  const { scene, camera } = viewer;
  centre.x = scene.canvas.clientWidth / 2;
  centre.y = scene.canvas.clientHeight / 2;
  if (scene.pickPositionSupported) {
    const p = scene.pickPosition(centre);
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) return p;
  }
  const ray = camera.getPickRay(centre);
  if (ray && scene.globe.show) {
    const g = scene.globe.pick(ray, scene);
    if (g) return g;
  }
  return camera.pickEllipsoid(centre, scene.globe.ellipsoid);
}

export interface ViewAngles {
  headingDeg: number;
  /** 0 = horizon, -90 = straight down. */
  pitchDeg: number;
}

export function currentView(viewer: Viewer): ViewAngles {
  return { headingDeg: normalizeDeg(CesiumMath.toDegrees(viewer.camera.heading)), pitchDeg: CesiumMath.toDegrees(viewer.camera.pitch) };
}

/** One turn/tilt gesture: the target, range and angles are measured once so repeated steps do not drift. */
export interface OrbitSession {
  /** Heading/pitch in degrees; unspecified ones keep their value from when the session began. */
  set(o: { headingDeg?: number; pitchDeg?: number; minPitchDeg?: number; maxPitchDeg?: number }): void;
}

const _enu = new Matrix4();
const _inv = new Matrix4();
const _local = new Cartesian3();

/**
 * Starts orbiting the screen-centre target at the current distance. Angles are taken in the
 * target's own local frame (east/north/up there), which is the frame `lookAt` uses, so setting
 * what you just read gives back the same view instead of drifting by the earth's curvature.
 * `minPitchDeg`/`maxPitchDeg` bound the pitch (so you cannot orbit below the ground).
 */
export function beginOrbit(viewer: Viewer): OrbitSession {
  const { camera } = viewer;
  const cur = currentView(viewer);
  const target = screenCentreTarget(viewer);
  if (!target) {
    return {
      set(o) {
        camera.setView({ orientation: { heading: CesiumMath.toRadians(o.headingDeg ?? cur.headingDeg), pitch: CesiumMath.toRadians(o.pitchDeg ?? cur.pitchDeg), roll: 0 } });
      },
    };
  }
  Transforms.eastNorthUpToFixedFrame(target, undefined, _enu);
  Matrix4.inverseTransformation(_enu, _inv);
  Matrix4.multiplyByPoint(_inv, camera.positionWC, _local);
  const range = Math.max(MIN_FLIGHT_HEIGHT_M, Cartesian3.magnitude(_local));
  const targetPitch = -CesiumMath.toDegrees(Math.asin(clamp(_local.z / range, -1, 1)));
  const targetHeading = normalizeDeg(CesiumMath.toDegrees(Math.atan2(-_local.x, -_local.y)));
  const headingOffset = shortestDeltaDeg(cur.headingDeg, targetHeading); // camera-frame vs target-frame heading
  const frozen = Cartesian3.clone(target);
  return {
    set(o) {
      const heading = (o.headingDeg ?? cur.headingDeg) + headingOffset;
      const pitch = o.pitchDeg === undefined ? targetPitch : clamp(o.pitchDeg + (targetPitch - cur.pitchDeg), o.minPitchDeg ?? -89.5, o.maxPitchDeg ?? -3);
      camera.lookAt(frozen, new HeadingPitchRange(CesiumMath.toRadians(heading), CesiumMath.toRadians(pitch), range));
      camera.lookAtTransform(Matrix4.IDENTITY); // release the lock so the mouse controls work normally
    },
  };
}

/** One-shot version of {@link beginOrbit}. */
export function setView(viewer: Viewer, o: { headingDeg?: number; pitchDeg?: number; minPitchDeg?: number; maxPitchDeg?: number }): void {
  beginOrbit(viewer).set(o);
}

let animation = 0;

/** Smoothly turns to a heading (the short way round), orbiting the centre target. Cancelled by the next call. */
export function animateHeading(viewer: Viewer, toDeg: number, durationMs = 550): void {
  cancelAnimationFrame(animation);
  viewer.camera.cancelFlight();
  const from = currentView(viewer).headingDeg;
  const delta = shortestDeltaDeg(from, toDeg);
  const orbit = beginOrbit(viewer);
  const t0 = performance.now();
  const step = (now: number): void => {
    const k = easeInOut((now - t0) / durationMs);
    orbit.set({ headingDeg: from + delta * k });
    if (k < 1) animation = requestAnimationFrame(step);
  };
  animation = requestAnimationFrame(step);
}

export function stopViewAnimation(): void {
  cancelAnimationFrame(animation);
}
