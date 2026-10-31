/** Camera helpers for the grid: oblique fly-to, top-down, reset. */

import { BoundingSphere, HeadingPitchRange, Math as CesiumMath, Rectangle } from 'cesium';
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
