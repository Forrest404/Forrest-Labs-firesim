/**
 * Pure maths for the compass and keyboard flight. No Cesium, no DOM, so it is unit-tested.
 * Headings are degrees clockwise from north; pitch is degrees with 0 = horizon, -90 = straight down
 * (Cesium's convention).
 */

export function normalizeDeg(d: number): number {
  return ((d % 360) + 360) % 360;
}

/** Signed shortest turn from one heading to another, in [-180, 180). */
export function shortestDeltaDeg(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export function compassPoint(deg: number): (typeof POINTS)[number] {
  return POINTS[Math.round(normalizeDeg(deg) / 45) % 8];
}

/** Angle of a pointer relative to a dial centre, degrees clockwise from straight up. */
export function pointerAngleDeg(dx: number, dy: number): number {
  return normalizeDeg((Math.atan2(dx, -dy) * 180) / Math.PI);
}

/**
 * Dragging the compass ring: the ring shows north rotated by -heading, and it follows the pointer, so
 * turning the ring clockwise by some angle turns the view counter-clockwise by the same angle.
 */
export function headingFromDialDrag(startHeadingDeg: number, startPointerDeg: number, pointerDeg: number): number {
  return normalizeDeg(startHeadingDeg - shortestDeltaDeg(startPointerDeg, pointerDeg));
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Tilt away from straight down: 0 = looking down, 90 = looking at the horizon. */
export function tiltFromPitchDeg(pitchDeg: number): number {
  return clamp(90 + pitchDeg, 0, 180);
}

export function easeInOut(t: number): number {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

export interface FlightKeys {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  lookUp: boolean;
  lookDown: boolean;
  fast: boolean;
}

export const NO_KEYS: FlightKeys = {
  forward: false, back: false, left: false, right: false, up: false, down: false,
  turnLeft: false, turnRight: false, lookUp: false, lookDown: false, fast: false,
};

/** Keyboard code -> action. Arrow keys look around, WASD moves, R/F rise and sink, Q/E turn. */
export const KEY_ACTIONS: Readonly<Record<string, keyof FlightKeys>> = {
  KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right', KeyR: 'up', KeyF: 'down',
  KeyQ: 'turnLeft', KeyE: 'turnRight', ArrowLeft: 'turnLeft', ArrowRight: 'turnRight',
  ArrowUp: 'lookUp', ArrowDown: 'lookDown', ShiftLeft: 'fast', ShiftRight: 'fast',
};

/**
 * Flight speed in m/s. Proportional to the height above the ground, so it is gentle near the
 * trees and quick high above the whole area (about a third of the altitude per second), with a
 * floor so you can always crawl along the ground.
 */
export function flightSpeedMps(altitudeM: number, fast: boolean): number {
  const base = Math.max(8, 0.35 * Math.max(0, altitudeM));
  return fast ? base * 4 : base;
}

/** Movement along the view direction, to the right, and straight up (-1, 0 or 1 each; opposite keys cancel). */
export function movementAxes(k: FlightKeys): { forward: number; right: number; up: number } {
  const forward = (k.forward ? 1 : 0) - (k.back ? 1 : 0);
  const right = (k.right ? 1 : 0) - (k.left ? 1 : 0);
  const up = (k.up ? 1 : 0) - (k.down ? 1 : 0);
  const len = Math.hypot(forward, right, up);
  return len > 1 ? { forward: forward / len, right: right / len, up: up / len } : { forward, right, up };
}

/** Yaw and pitch rates in degrees per second (positive = turn right / look up). */
export function turnRates(k: FlightKeys): { yaw: number; pitch: number } {
  const rate = k.fast ? 90 : 45;
  return { yaw: ((k.turnRight ? 1 : 0) - (k.turnLeft ? 1 : 0)) * rate, pitch: ((k.lookUp ? 1 : 0) - (k.lookDown ? 1 : 0)) * rate };
}

export function anyKeyHeld(k: FlightKeys): boolean {
  const { forward, right, up } = movementAxes(k);
  const { yaw, pitch } = turnRates(k);
  return forward !== 0 || right !== 0 || up !== 0 || yaw !== 0 || pitch !== 0;
}

/** Lowest height (m) the keyboard may fly to, so you cannot end up under the ground. */
export const MIN_FLIGHT_HEIGHT_M = 3;
