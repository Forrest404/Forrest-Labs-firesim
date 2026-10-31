import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NEVER_ARRIVES } from '../src/contract';
import type { SimResult } from '../src/contract';
import { homesReached, overlapAtRealSize, totalHomes } from '../src/app/impact';
import { enforceBudget, suggestPlan } from '../src/app/planner';
import { decodeBundle, encodeBundle, scenarioFromArea } from '../src/data/bundle';
import type { DemoAreaBundle } from '../src/data/bundle';
import { makeGridSpec } from '../src/data/geo';
import { makeSyntheticArea } from '../src/data/synthetic';

const grid = makeGridSpec({ centerLon: 0, centerLat: 0, width: 4, height: 4, cellSizeM: 30 });
const result = (arrival: number[]): SimResult => ({
  arrivalTime: Float32Array.from(arrival),
  firelineIntensityKwM: new Float32Array(arrival.length),
  flameLengthM: new Float32Array(arrival.length),
  sourceCell: new Int32Array(arrival.length).fill(-1),
  ignitedByEmber: new Uint8Array(arrival.length),
  stats: { burnedCells: 0, burnedAreaHa: 0, maxSpreadRateMps: 0, spotFires: 0, maxIntensityKwM: 0, maxFlameLengthM: 0, runtimeMs: 0 },
});
const I = NEVER_ARRIVES;

describe('impact', () => {
  it('counts a home as reached when fire arrives in its cell or next to it', () => {
    const homes = new Uint16Array(16);
    homes[0] = 2; // corner, neighbour (1,1) burns at 100 s
    homes[15] = 3; // far corner, nothing near burns
    const r = result([I, I, I, I, I, 100, I, I, I, I, I, I, I, I, I, I]);
    expect(homesReached(r, homes, grid, 50)).toBe(0);
    expect(homesReached(r, homes, grid, 100)).toBe(2);
    expect(totalHomes(homes)).toBe(5);
  });

  it('compares shapes at the moment the run reaches the real size', () => {
    const mask = new Uint8Array(16);
    mask[0] = mask[1] = 1;
    const ref = { name: 'x', summary: '', source: '', areaHa: 0.18, mask, rings: [] };
    const exact = overlapAtRealSize(result([10, 20, 30, ...Array(13).fill(I)]), ref);
    expect(exact?.iou).toBe(1);
    expect(exact?.t).toBe(20);
    expect(overlapAtRealSize(result([10, ...Array(15).fill(I)]), ref)).toBeNull();
  });
});

describe('bundle extras', () => {
  it('round-trips homes and a reference fire', () => {
    const area = makeSyntheticArea({ name: 't', label: 'T', centerLon: 8.4, centerLat: 48.345, seed: 5, style: 'valley' });
    const n = area.grid.width * area.grid.height;
    area.homes = new Uint16Array(n);
    area.homes[123] = 7;
    const mask = new Uint8Array(n);
    mask[5] = 1;
    area.reference = { name: 'R', summary: 's', source: 'src', areaHa: 1.5, mask, rings: [[[8.4, 48.3], [8.5, 48.3], [8.4, 48.3]]] };
    const back = decodeBundle(JSON.parse(JSON.stringify(encodeBundle(area))) as DemoAreaBundle);
    expect(back.homes?.[123]).toBe(7);
    expect(back.reference?.mask[5]).toBe(1);
    expect(back.reference?.rings[0][1]).toEqual([8.5, 48.3]);
    expect('homesBase64' in back.meta).toBe(false);
  });
});

describe('planner', () => {
  const bc = decodeBundle(JSON.parse(readFileSync('public/demo-areas/boulder-creek.json', 'utf8')) as DemoAreaBundle);
  const scenario = scenarioFromArea(bc, { weather: { windSpeedMps: 40 / 3.6, windFromDeg: 250 } });

  it('keeps proposals inside the grid, the line count and the firebreak budget', () => {
    const { proposal, note } = enforceBudget(
      { lines: [{ r1: -5, c1: 0, r2: 500, c2: 0 }, { r1: 0, c1: 0, r2: 0, c2: 10 }, { r1: 1, c1: 1, r2: 1, c2: 2 }, { r1: 2, c1: 2, r2: 2, c2: 3 }], tMinutes: 5, rationale: 'r' },
      scenario,
    );
    expect(proposal.lines).toHaveLength(1);
    expect(proposal.lines[0].r1).toBe(0);
    expect(proposal.lines[0].r2).toBe(150);
    expect(proposal.tMinutes).toBe(30);
    expect(note).toMatch(/first 3 lines/);
  });

  it('only accepts a plan the simulator confirms', async () => {
    const out = await suggestPlan(scenario, { homes: bc.homes });
    expect(out.state.status).toBe('done');
    for (const a of out.state.attempts) {
      const cut = (a.homesBefore - a.homesAfter) / a.homesBefore;
      expect(a.accepted).toBe(cut >= 0.25);
    }
  });

  it('feeds rejected attempts back to Gemini and parses its JSON', async () => {
    const prompts: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      prompts.push(JSON.parse(String(init?.body)).contents[0].parts[0].text as string);
      const plan = { lines: [{ r1: 0, c1: 0, r2: 0, c2: 5 }], t_minutes: 60, rationale: 'tiny break far away' };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(plan) }] } }] }));
    }) as typeof fetch;
    const out = await suggestPlan(scenario, { apiKey: 'test', homes: bc.homes, fetchImpl });
    expect(out.state.source).toBe('gemini');
    expect(out.accepted).toBe(false);
    expect(out.state.attempts).toHaveLength(3);
    expect(prompts[1]).toContain('Previous attempts, verified by the simulator');
    expect(out.state.attempts[0].proposal.tMinutes).toBe(60);
  });

  it('falls back to the built-in planner when Gemini fails', async () => {
    const fetchImpl = (async () => new Response('quota', { status: 429 })) as typeof fetch;
    const out = await suggestPlan(scenario, { apiKey: 'test', homes: bc.homes, fetchImpl });
    expect(out.state.status).toBe('done');
    expect(out.state.attempts.length).toBeGreaterThan(0);
    expect(out.state.attempts[0].source).toBe('builtin');
    expect(out.state.attempts[0].note).toMatch(/Gemini unavailable \(.*429.*\); built-in plan used/);
  });
});
