/**
 * Free flight with the keyboard, in proper 3D: W/S move along where you are looking (so looking down
 * and pressing W dives), A/D strafe, R/F rise and sink along the local vertical, Q/E (or left/right
 * arrows) turn about the vertical, up/down arrows look up and down, Shift is 4x faster. Speed scales
 * with height above the ground. The mouse controls keep working: drag to rotate, scroll to zoom,
 * middle-drag or Ctrl-drag to tilt.
 */

import { Cartesian3, Math as CesiumMath } from 'cesium';
import type { Viewer } from 'cesium';
import { KEY_ACTIONS, MIN_FLIGHT_HEIGHT_M, NO_KEYS, anyKeyHeld, flightSpeedMps, movementAxes, turnRates } from './cameraMath';
import type { FlightKeys } from './cameraMath';

export interface Flight {
  /** Currently held keys (read-only snapshot, for tests and the HUD). */
  keys(): FlightKeys;
  destroy(): void;
}

function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target.isContentEditable;
}

const normal = new Cartesian3();

export function startFlight(viewer: Viewer): Flight {
  const keys: FlightKeys = { ...NO_KEYS };
  let last = performance.now();

  const onDown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey || typingInto(e.target)) return;
    const action = KEY_ACTIONS[e.code];
    if (!action) return;
    if (action !== 'fast' && !anyKeyHeld(keys)) viewer.camera.cancelFlight(); // taking over from an automatic fly-to
    keys[action] = true;
    e.preventDefault(); // arrow keys would otherwise scroll the page
  };
  const onUp = (e: KeyboardEvent): void => {
    const action = KEY_ACTIONS[e.code];
    if (action) keys[action] = false;
  };
  const releaseAll = (): void => {
    Object.assign(keys, NO_KEYS);
  };

  const onFrame = (): void => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000); // a stalled frame must not teleport the camera
    last = now;
    if (!anyKeyHeld(keys)) return;
    const { camera, scene } = viewer;
    const ellipsoid = scene.globe.ellipsoid;
    const height = camera.positionCartographic.height;
    const speed = flightSpeedMps(height, keys.fast) * dt;
    const m = movementAxes(keys);
    if (m.forward) camera.moveForward(m.forward * speed);
    if (m.right) camera.moveRight(m.right * speed);
    ellipsoid.geodeticSurfaceNormal(camera.positionWC, normal);
    if (m.up) camera.move(normal, m.up * speed);
    const t = turnRates(keys);
    if (t.yaw) camera.look(normal, CesiumMath.toRadians(t.yaw * dt)); // positive = clockwise = turn right
    if (t.pitch) {
      const rad = CesiumMath.toRadians(Math.abs(t.pitch) * dt);
      const next = CesiumMath.toDegrees(camera.pitch) + Math.sign(t.pitch) * Math.abs(t.pitch) * dt;
      // Do not flip over the poles of the view: keep pitch within [-89.5, 89.5].
      if (next > -89.5 && next < 89.5) (t.pitch > 0 ? camera.lookUp(rad) : camera.lookDown(rad));
    }
    // Never end up under the ground.
    const after = camera.positionCartographic.height;
    if (after < MIN_FLIGHT_HEIGHT_M) {
      ellipsoid.geodeticSurfaceNormal(camera.positionWC, normal);
      camera.move(normal, MIN_FLIGHT_HEIGHT_M - after);
    }
  };

  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);
  window.addEventListener('blur', releaseAll);
  viewer.scene.preRender.addEventListener(onFrame);
  // Keep the camera usable close to the ground: Cesium's default minimum zoom is 1 m.
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 5;

  return {
    keys: () => ({ ...keys }),
    destroy() {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', releaseAll);
      viewer.scene.preRender.removeEventListener(onFrame);
    },
  };
}

