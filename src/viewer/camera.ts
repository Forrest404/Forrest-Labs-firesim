/** Camera helpers for the grid: oblique fly-to, top-down, reset, ground view. */

import { BoundingSphere, Cartesian3, HeadingPitchRange, Math as CesiumMath, Rectangle } from 'cesium';
import type { Viewer } from 'cesium';
import type { GridSpec } from '../contract';

function gridRectangle(grid: GridSpec): Rectangle {
  const b = grid.bounds;
  return Rectangle.fromDegrees(b.west, b.south, b.east, b.north);
}

/** Oblique view from the south, the whole grid in frame. */
export function flyToGrid(viewer: Viewer, grid: GridSpec, durationS = 2): void {
  const sphere = BoundingSphere.fromRectangle3D(gridRectangle(grid));
  viewer.camera.flyToBoundingSphere(sphere, {
    duration: durationS,
    offset: new HeadingPitchRange(0, CesiumMath.toRadians(-38), sphere.radius * 2.6),
  });
}

/** Straight down, north up. */
export function flyTopDown(viewer: Viewer, grid: GridSpec, durationS = 1.2): void {
  const sphere = BoundingSphere.fromRectangle3D(gridRectangle(grid));
  viewer.camera.flyToBoundingSphere(sphere, {
    duration: durationS,
    offset: new HeadingPitchRange(0, CesiumMath.toRadians(-90), sphere.radius * 2.3),
  });
}

// TODO(3d-polish): followFireFront(viewer, grid, arrivalTime, t) that keeps the active front in
// frame while the simulation plays (stretch).

export interface GroundPose {
  lon: number;
  lat: number;
  /** Camera height above the ellipsoid, metres. */
  heightM: number;
  /** Compass heading the camera looks toward, degrees. */
  headingDeg: number;
}

/**
 * Ground view: low and in front of the fire, looking back at it as it comes toward you.
 * `front` is the fire front (or ignition), `towardDeg` the direction the wind pushes the fire.
 */
export function groundPose(front: { lon: number; lat: number }, groundM: number, towardDeg: number, distanceM = 1300, heightM = 300): GroundPose {
  const a = CesiumMath.toRadians(towardDeg);
  const dx = Math.sin(a) * distanceM;
  const dy = Math.cos(a) * distanceM;
  return {
    lon: front.lon + dx / (111320 * Math.cos(CesiumMath.toRadians(front.lat))),
    lat: front.lat + dy / 111320,
    heightM: groundM + heightM,
    headingDeg: (towardDeg + 180) % 360,
  };
}

export function flyToGround(viewer: Viewer, p: GroundPose, durationS = 1.5): void {
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(p.lon, p.lat, p.heightM),
    orientation: { heading: CesiumMath.toRadians(p.headingDeg), pitch: CesiumMath.toRadians(-20), roll: 0 },
    duration: durationS,
  });
}
