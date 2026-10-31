import { describe, expect, it } from 'vitest';
import {
  KEY_ACTIONS, MIN_FLIGHT_HEIGHT_M, NO_KEYS, anyKeyHeld, clamp, compassPoint, easeInOut, flightSpeedMps, headingFromDialDrag, movementAxes, normalizeDeg,
  pointerAngleDeg, shortestDeltaDeg, tiltFromPitchDeg, turnRates,
} from '../src/viewer/cameraMath';
import type { FlightKeys } from '../src/viewer/cameraMath';

const keys = (o: Partial<FlightKeys>): FlightKeys => ({ ...NO_KEYS, ...o });

describe('headings', () => {
  it('normalise into [0, 360) and take the shortest turn', () => {
    expect(normalizeDeg(-10)).toBe(350);
    expect(normalizeDeg(370)).toBe(10);
    expect(normalizeDeg(720)).toBe(0);
    expect(shortestDeltaDeg(350, 10)).toBe(20);
    expect(shortestDeltaDeg(10, 350)).toBe(-20);
    expect(shortestDeltaDeg(0, 180)).toBe(-180);
    expect(shortestDeltaDeg(90, 90)).toBe(0);
    for (let a = -400; a <= 400; a += 37) for (let b = -400; b <= 400; b += 53) {
      const d = shortestDeltaDeg(a, b);
      expect(d).toBeGreaterThanOrEqual(-180);
      expect(d).toBeLessThan(180);
      expect(normalizeDeg(a + d)).toBeCloseTo(normalizeDeg(b), 9);
    }
  });

  it('names the eight compass points', () => {
    expect([0, 44, 46, 90, 135, 180, 225, 270, 315, 359, 360].map(compassPoint)).toEqual(['N', 'NE', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'N']);
  });
});

describe('compass dial', () => {
  it('pointer angle is clockwise from straight up', () => {
    expect(pointerAngleDeg(0, -10)).toBeCloseTo(0, 9); // above the centre
    expect(pointerAngleDeg(10, 0)).toBeCloseTo(90, 9); // right
    expect(pointerAngleDeg(0, 10)).toBeCloseTo(180, 9); // below
    expect(pointerAngleDeg(-10, 0)).toBeCloseTo(270, 9); // left
  });

  it('dragging the ring clockwise turns the view counter-clockwise, and a full circle is no change', () => {
    expect(headingFromDialDrag(0, 0, 30)).toBeCloseTo(330, 9);
    expect(headingFromDialDrag(0, 0, 330)).toBeCloseTo(30, 9);
    expect(headingFromDialDrag(100, 90, 90)).toBeCloseTo(100, 9);
    expect(headingFromDialDrag(100, 350, 10)).toBeCloseTo(80, 9); // across the 0 / 360 seam, shortest way
  });

  it('the north mark follows the pointer: after a drag, the ring angle of north equals where it started plus the pointer move', () => {
    for (const h0 of [0, 35, 200, 359]) for (const a0 of [10, 120, 300]) for (const a1 of [0, 77, 250, 355]) {
      const ringBefore = normalizeDeg(-h0);
      const h1 = headingFromDialDrag(h0, a0, a1);
      const ringAfter = normalizeDeg(-h1);
      expect(normalizeDeg(ringAfter - ringBefore)).toBeCloseTo(normalizeDeg(shortestDeltaDeg(a0, a1)), 9);
    }
  });
});

describe('tilt and easing', () => {
  it('tilt is 0 looking down and 90 at the horizon; clamp and easing are bounded and monotone', () => {
    expect(tiltFromPitchDeg(-90)).toBe(0);
    expect(tiltFromPitchDeg(-45)).toBe(45);
    expect(tiltFromPitchDeg(0)).toBe(90);
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 12);
    let prev = 0;
    for (let t = 0; t <= 1.0001; t += 0.01) { const e = easeInOut(t); expect(e).toBeGreaterThanOrEqual(prev - 1e-12); prev = e; }
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(2)).toBe(1);
  });
});

describe('keyboard flight', () => {
  it('maps the documented keys to actions', () => {
    expect(KEY_ACTIONS.KeyW).toBe('forward');
    expect(KEY_ACTIONS.KeyS).toBe('back');
    expect(KEY_ACTIONS.KeyA).toBe('left');
    expect(KEY_ACTIONS.KeyD).toBe('right');
    expect(KEY_ACTIONS.KeyR).toBe('up');
    expect(KEY_ACTIONS.KeyF).toBe('down');
    expect(KEY_ACTIONS.KeyQ).toBe('turnLeft');
    expect(KEY_ACTIONS.KeyE).toBe('turnRight');
    expect(KEY_ACTIONS.ShiftLeft).toBe('fast');
    expect(KEY_ACTIONS.Space).toBeUndefined(); // Space is play/pause
    expect(KEY_ACTIONS.Escape).toBeUndefined();
    expect(KEY_ACTIONS.KeyZ).toBeUndefined(); // Cmd/Ctrl+Z is undo
  });

  it('speed grows with altitude, has a floor, and fast is 4x', () => {
    expect(flightSpeedMps(0, false)).toBe(8);
    expect(flightSpeedMps(10, false)).toBe(8);
    expect(flightSpeedMps(1000, false)).toBeCloseTo(350, 9);
    expect(flightSpeedMps(100_000, false)).toBeCloseTo(35_000, 6);
    expect(flightSpeedMps(1000, true)).toBeCloseTo(1400, 9);
    expect(flightSpeedMps(-50, false)).toBe(8);
    let prev = 0;
    for (const h of [0, 50, 500, 5000, 50_000]) { const v = flightSpeedMps(h, false); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
  });

  it('movement axes: opposite keys cancel, diagonals are normalised, nothing held means no movement', () => {
    expect(movementAxes(NO_KEYS)).toEqual({ forward: 0, right: 0, up: 0 });
    expect(movementAxes(keys({ forward: true }))).toEqual({ forward: 1, right: 0, up: 0 });
    expect(movementAxes(keys({ forward: true, back: true }))).toEqual({ forward: 0, right: 0, up: 0 });
    expect(movementAxes(keys({ left: true, right: true, up: true }))).toEqual({ forward: 0, right: 0, up: 1 });
    const d = movementAxes(keys({ forward: true, right: true }));
    expect(Math.hypot(d.forward, d.right, d.up)).toBeCloseTo(1, 12);
    const t = movementAxes(keys({ forward: true, right: true, up: true }));
    expect(Math.hypot(t.forward, t.right, t.up)).toBeCloseTo(1, 12);
    expect(movementAxes(keys({ back: true })).forward).toBe(-1);
    expect(movementAxes(keys({ down: true })).up).toBe(-1);
    expect(movementAxes(keys({ left: true })).right).toBe(-1);
  });

  it('turn rates: right and up are positive, fast doubles, opposite keys cancel', () => {
    expect(turnRates(keys({ turnRight: true }))).toEqual({ yaw: 45, pitch: 0 });
    expect(turnRates(keys({ turnLeft: true }))).toEqual({ yaw: -45, pitch: 0 });
    expect(turnRates(keys({ lookUp: true, fast: true }))).toEqual({ yaw: 0, pitch: 90 });
    expect(turnRates(keys({ lookDown: true }))).toEqual({ yaw: 0, pitch: -45 });
    expect(turnRates(keys({ turnLeft: true, turnRight: true }))).toEqual({ yaw: 0, pitch: 0 });
  });

  it('anyKeyHeld ignores the Shift modifier on its own', () => {
    expect(anyKeyHeld(NO_KEYS)).toBe(false);
    expect(anyKeyHeld(keys({ fast: true }))).toBe(false);
    expect(anyKeyHeld(keys({ lookDown: true }))).toBe(true);
    expect(anyKeyHeld(keys({ forward: true, back: true }))).toBe(false);
  });
});

describe('flight floor', () => {
  it('keeps the camera at least 3 m above the surface', () => {
    expect(MIN_FLIGHT_HEIGHT_M).toBe(3);
  });
});
