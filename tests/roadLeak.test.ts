import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, DEFAULT_WEATHER, FuelClass, applyDrynessPreset } from '../src/contract';
import type { Scenario } from '../src/contract';
import { cellFloatToLonLat, makeGridSpec } from '../src/data/geo';
import { buildFuelGrid } from '../src/data/osm';
import type { OsmElement } from '../src/data/osm';
import { lineCells } from '../src/data/raster';
import type { Pt } from '../src/data/raster';
import { simulate } from '../src/sim';
import { mulberry32 } from '../src/sim/prng';

const N = 60;
const grid = makeGridSpec({ centerLon: -0.376, centerLat: 51.175, width: N, height: N });

/** 8-neighbour flood fill over burnable cells (the solver spreads through exactly these moves). */
function flood(fuel: Uint8Array, start: number): Uint8Array {
  const seen = new Uint8Array(fuel.length);
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const r = Math.floor(i / N);
    const c = i % N;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if ((dr === 0 && dc === 0) || rr < 0 || cc < 0 || rr >= N || cc >= N) continue;
        const j = rr * N + cc;
        if (seen[j] || fuel[j] === FuelClass.NONE) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  return seen;
}

/** A random polyline that crosses the whole grid from one side to the other (x or y monotone). */
function crossing(rand: () => number, horizontal: boolean): Pt[] {
  const pts: Pt[] = [];
  const steps = 3 + Math.floor(rand() * 9);
  let across = 15 + rand() * 30;
  for (let k = 0; k <= steps; k++) {
    const along = -2 + ((N + 4) * k) / steps + (k > 0 && k < steps ? (rand() - 0.5) * 6 : 0);
    // Some vertices land exactly on cell corners / centres on purpose: those are the awkward ones.
    across = Math.min(N - 8, Math.max(8, across + (rand() - 0.5) * 24));
    const a = rand() < 0.25 ? Math.round(across) : rand() < 0.2 ? Math.floor(across) + 0.5 : across;
    pts.push(horizontal ? [along, a] : [a, along]);
  }
  pts.sort((p, q) => (horizontal ? p[0] - q[0] : p[1] - q[1]));
  return pts;
}

const toWay = (pts: Pt[], tags: Record<string, string>): OsmElement => ({
  type: 'way', id: 1, tags,
  geometry: pts.map(([x, y]) => {
    const p = cellFloatToLonLat(grid, x, y);
    return { lat: p.lat, lon: p.lon };
  }),
});

describe('roads cannot be crossed by an 8-neighbour fire', () => {
  it('lineCells(width 1) is one 4-connected piece for random polylines (fuzz, 400 lines)', () => {
    const rand = mulberry32(11);
    for (let t = 0; t < 400; t++) {
      const pts = crossing(rand, rand() < 0.5);
      const cells = lineCells(N, N, pts, 1);
      expect(cells.length).toBeGreaterThan(N / 2);
      const inLine = new Set(cells);
      const seen = new Set<number>([cells[0]]);
      const stack = [cells[0]];
      while (stack.length) {
        const i = stack.pop()!;
        for (const j of [i - 1, i + 1, i - N, i + N]) {
          // no wrap across rows
          if (!inLine.has(j) || seen.has(j) || (Math.abs((j % N) - (i % N)) > 1)) continue;
          seen.add(j);
          stack.push(j);
        }
      }
      expect(seen.size, `line ${t}`).toBe(cells.length);
    }
  });

  it('a road built through buildFuelGrid separates the two sides for 8-neighbour moves (fuzz, 300 roads, every road class and width)', () => {
    const rand = mulberry32(23);
    const kinds: Record<string, string>[] = [{ highway: 'primary' }, { highway: 'secondary' }, { highway: 'tertiary' }, { highway: 'trunk' }, { waterway: 'river' }, { railway: 'rail' }];
    for (let t = 0; t < 300; t++) {
      const horizontal = t % 2 === 0;
      const road = toWay(crossing(rand, horizontal), kinds[t % kinds.length]);
      const { fuel } = buildFuelGrid([road], grid, { defaultFuel: FuelClass.FOREST_CONIFER });
      // (0,0) is on one side; the far corner on the other (the line is kept 8+ cells from the edges).
      const reach = flood(fuel, 0);
      const far = (N - 1) * N + (N - 1); // bottom-right
      expect(fuel[0], `road ${t}`).not.toBe(FuelClass.NONE);
      expect(reach[far], `road ${t} leaks between top-left and bottom-right`).toBe(0);
      expect(reach[horizontal ? (N - 1) * N : N - 1], `road ${t} leaks`).toBe(0);
    }
  });

  it('the solver: a fire pushed hard at a 1-cell road never burns the far side (fuzz, 40 roads)', () => {
    const rand = mulberry32(37);
    for (let t = 0; t < 40; t++) {
      const horizontal = t % 2 === 0;
      const road = toWay(crossing(rand, horizontal), { highway: 'tertiary' });
      const { fuel } = buildFuelGrid([road], grid, { defaultFuel: FuelClass.FOREST_CONIFER });
      const reach = flood(fuel, 0);
      const side = fuel.map((_, i) => (reach[i] ? 1 : 0));
      // wind blows from the top-left corner side towards the far side, as hard as the model allows
      const scenario: Scenario = {
        grid,
        fuel,
        elevation: new Float32Array(N * N),
        weather: applyDrynessPreset({ ...DEFAULT_WEATHER, windSpeedMps: 25, windFromDeg: horizontal ? 350 : 280 }, 'extreme'),
        ignition: [{ row: 1, col: 1 }],
        interventions: [],
        durationSeconds: 24 * 3600,
        seed: 1,
        settings: { ...DEFAULT_SETTINGS },
      };
      const { arrivalTime } = simulate(scenario);
      let burnedSide = 0;
      for (let i = 0; i < arrivalTime.length; i++) {
        if (arrivalTime[i] !== Infinity) {
          burnedSide++;
          expect(side[i], `road ${t}: cell ${i} burned on the far side`).toBe(1);
        }
      }
      expect(burnedSide, `road ${t} the fire should fill its own side`).toBeGreaterThan(300);
    }
  });
});
