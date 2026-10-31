import { describe, expect, it } from 'vitest';
import { FuelClass, NEVER_ARRIVES } from '../src/contract';
import { paintBurn, paintCheckerboard, paintFuel, parseRgba } from '../src/viewer/burnCanvas';

describe('burnCanvas painters', () => {
  it('parses rgba strings', () => {
    expect(parseRgba('rgba(10, 20, 30, 0.5)')).toEqual([10, 20, 30, 128]);
    expect(parseRgba('rgb(1,2,3)')).toEqual([1, 2, 3, 255]);
  });

  it('paints fuel with a distinct colour per class and keeps NONE semi-transparent', () => {
    const fuel = new Uint8Array([FuelClass.NONE, FuelClass.GRASS, FuelClass.FOREST_CONIFER]);
    const data = new Uint8ClampedArray(fuel.length * 4);
    paintFuel(data, fuel);
    expect(data[3]).toBeLessThan(255);
    expect([data[4], data[5], data[6]]).not.toEqual([data[8], data[9], data[10]]);
  });

  it('paints unburned transparent, fresh fire bright, old fire charred, breaks grey, water blue', () => {
    const arrival = new Float32Array([NEVER_ARRIVES, 100, 100, 100, 5000, 100]);
    const data = new Uint8ClampedArray(arrival.length * 4);
    const firebreak = new Uint8Array([0, 0, 0, 1, 0, 0]);
    const wetness = new Float32Array([0, 0, 0, 0, 0, 1]);
    paintBurn(data, arrival, 200, { flameWindowS: 600, firebreak, wetness });
    expect(data[3]).toBe(0); // never ignited
    expect(data[4]).toBe(255); // fresh: red channel full
    expect(data[7]).toBeGreaterThan(200);
    expect(data[12]).toBeGreaterThan(200); // firebreak light grey
    expect(data[12]).toBe(data[13]);
    expect(data[16 + 3]).toBe(0); // arrival 5000 > t=200: not yet burning
    expect(data[20 + 2]).toBeGreaterThan(data[20]); // wet cell: blue dominates
    paintBurn(data, arrival, 5000, { flameWindowS: 600 });
    expect(data[4]).toBeLessThan(60); // old fire: charred dark
    expect(data[16]).toBe(255); // arrival 5000 at t=5000: just ignited
  });

  it('checkerboard marks NW red and SE blue', () => {
    const w = 40;
    const h = 40;
    const data = new Uint8ClampedArray(w * h * 4);
    paintCheckerboard(data, w, h);
    expect(data[0]).toBe(255);
    expect(data[2]).toBe(0);
    const se = ((h - 1) * w + (w - 1)) * 4;
    expect(data[se + 2]).toBe(255);
    expect(data[se]).toBe(0);
  });
});
