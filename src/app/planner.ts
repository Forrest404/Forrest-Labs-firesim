/**
 * "Suggest a plan": Gemini proposes firebreaks, the simulator checks every proposal against the
 * same fire without it, and only a plan that measurably helps is accepted. Rejected plans go back
 * to Gemini with the numbers. Without an API key a simple built-in planner stands in, labelled.
 *
 * The planner never trusts the model's claim that a plan works: the verdict is always the sim's.
 */

import { FuelClass, NEVER_ARRIVES, cellAreaHa, windTowardDeg } from '../contract';
import type { Intervention, Scenario, SimResult } from '../contract';
import { simulate } from '../sim';
import { firebreakCells } from '../tools/firebreak';
import { homesReached } from './impact';

export interface PlanLine {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export interface Proposal {
  lines: PlanLine[];
  tMinutes: number;
  rationale: string;
}

export interface PlanAttempt {
  n: number;
  source: 'gemini' | 'builtin';
  proposal: Proposal;
  homesBefore: number;
  homesAfter: number;
  areaBeforeHa: number;
  areaAfterHa: number;
  accepted: boolean;
  /** Why it was rejected, or what was trimmed. */
  note: string;
}

export interface PlanState {
  status: 'running' | 'done' | 'error';
  source: 'gemini' | 'builtin';
  attempts: PlanAttempt[];
  message: string;
}

/** Crews can cut this much firebreak in total (cells of 30 m, so 4.5 km). */
export const BREAK_BUDGET_CELLS = 150;
export const MAX_LINES = 3;
/** First crews arrive this long after ignition. */
export const EARLIEST_MINUTES = 30;
const BREAK_WIDTH_CELLS = 3;
const MAX_ATTEMPTS = 3;
/** A plan is accepted if it cuts homes reached (or, with no homes at risk, burned area) by this share. */
const ACCEPT_REDUCTION = 0.25;

export interface PlannerOptions {
  apiKey?: string;
  model?: string;
  homes?: Uint16Array;
  onUpdate?(state: PlanState): void;
  fetchImpl?: typeof fetch;
}

export interface PlanOutcome {
  state: PlanState;
  /** Interventions of the accepted plan, or of the best rejected one if none passed. */
  interventions: Intervention[];
  accepted: boolean;
}

export async function suggestPlan(scenario: Scenario, opts: PlannerOptions = {}): Promise<PlanOutcome> {
  const source: PlanState['source'] = opts.apiKey ? 'gemini' : 'builtin';
  const state: PlanState = { status: 'running', source, attempts: [], message: '' };
  const emit = (): void => opts.onUpdate?.({ ...state, attempts: [...state.attempts] });
  const base: Scenario = { ...scenario, interventions: [] };
  const baseline = simulate(base);
  const score = (r: SimResult): { homes: number; areaHa: number } => ({
    homes: opts.homes ? homesReached(r, opts.homes, scenario.grid, scenario.durationSeconds) : 0,
    areaHa: burnedCells(r) * cellAreaHa(scenario.grid),
  });
  const before = score(baseline);
  let best: { attempt: PlanAttempt; interventions: Intervention[] } | null = null;

  try {
    for (let n = 1; n <= MAX_ATTEMPTS; n++) {
      const raw = source === 'gemini'
        ? await askGemini(describe(scenario, baseline, opts.homes, state.attempts), opts)
        : builtinProposal(scenario, baseline, n);
      const { proposal, note: trimNote } = enforceBudget(raw, scenario);
      const interventions = toInterventions(proposal, scenario, n);
      const after = score(simulate({ ...base, interventions }));
      const reduction = before.homes > 0
        ? (before.homes - after.homes) / before.homes
        : before.areaHa > 0 ? (before.areaHa - after.areaHa) / before.areaHa : 0;
      const accepted = reduction >= ACCEPT_REDUCTION;
      const attempt: PlanAttempt = {
        n,
        source,
        proposal,
        homesBefore: before.homes,
        homesAfter: after.homes,
        areaBeforeHa: before.areaHa,
        areaAfterHa: after.areaHa,
        accepted,
        note: [trimNote, accepted ? '' : `Only ${Math.round(reduction * 100)} % better; needs ${Math.round(ACCEPT_REDUCTION * 100)} %.`].filter(Boolean).join(' '),
      };
      state.attempts.push(attempt);
      emit();
      if (!best || after.homes < best.attempt.homesAfter || (after.homes === best.attempt.homesAfter && after.areaHa < best.attempt.areaAfterHa)) {
        best = { attempt, interventions };
      }
      if (accepted) break;
    }
    state.status = 'done';
    state.message = best?.attempt.accepted ? `Plan ${best.attempt.n} passed the simulator check.` : 'No plan passed the check. Showing the best one.';
    emit();
    return { state, interventions: best?.interventions ?? [], accepted: !!best?.attempt.accepted };
  } catch (err) {
    state.status = 'error';
    state.message = err instanceof Error ? err.message : String(err);
    emit();
    return { state, interventions: best?.interventions ?? [], accepted: false };
  }
}

function burnedCells(r: SimResult): number {
  let n = 0;
  for (const t of r.arrivalTime) if (t !== NEVER_ARRIVES) n++;
  return n;
}

/** Clamps to the grid, drops extra lines, shortens lines past the budget, respects the earliest time. */
export function enforceBudget(p: Proposal, scenario: Scenario): { proposal: Proposal; note: string } {
  const { width: W, height: H } = scenario.grid;
  const clamp = (v: number, max: number): number => Math.max(0, Math.min(max - 1, Math.round(Number(v) || 0)));
  const notes: string[] = [];
  let lines = (Array.isArray(p.lines) ? p.lines : []).map((l) => ({ r1: clamp(l.r1, H), c1: clamp(l.c1, W), r2: clamp(l.r2, H), c2: clamp(l.c2, W) }));
  if (lines.length > MAX_LINES) {
    lines = lines.slice(0, MAX_LINES);
    notes.push(`Kept the first ${MAX_LINES} lines.`);
  }
  let left = BREAK_BUDGET_CELLS;
  lines = lines.flatMap((l) => {
    const len = Math.hypot(l.r2 - l.r1, l.c2 - l.c1);
    if (left <= 0) return [];
    if (len <= left) {
      left -= len;
      return [l];
    }
    const k = left / len;
    left = 0;
    notes.push('Shortened to fit the 4.5 km firebreak budget.');
    return [{ ...l, r2: Math.round(l.r1 + (l.r2 - l.r1) * k), c2: Math.round(l.c1 + (l.c2 - l.c1) * k) }];
  });
  const tMinutes = Math.max(EARLIEST_MINUTES, Math.round(Number(p.tMinutes) || EARLIEST_MINUTES));
  return { proposal: { lines, tMinutes, rationale: String(p.rationale ?? '') }, note: notes.join(' ') };
}

export function toInterventions(p: Proposal, scenario: Scenario, attempt: number): Intervention[] {
  return p.lines
    .map((l, i): Intervention => ({
      id: `plan-${attempt}-${i}`,
      tSeconds: p.tMinutes * 60,
      type: 'firebreak',
      cells: firebreakCells(scenario.grid, [[l.c1 + 0.5, l.r1 + 0.5], [l.c2 + 0.5, l.r2 + 0.5]], BREAK_WIDTH_CELLS),
      label: `Plan ${attempt}`,
    }))
    .filter((iv) => iv.cells.length > 0);
}

/** Built-in stand-in: one break across the downwind path, a little further out on each retry. */
export function builtinProposal(scenario: Scenario, baseline: SimResult, attempt: number): Proposal {
  const { width: W, height: H } = scenario.grid;
  const ign = scenario.ignition[0];
  const toward = (windTowardDeg(scenario.weather.windFromDeg) * Math.PI) / 180;
  const dx = Math.sin(toward);
  const dy = -Math.cos(toward);
  const tMinutes = EARLIEST_MINUTES;
  // Walk downwind to where the fire arrives this long after the crews do, so there's time to cut.
  const target = tMinutes * 60 + [45, 90, 150][attempt - 1] * 60;
  let dist = 6;
  for (let d = 6; d < Math.max(W, H); d++) {
    const r = Math.round(ign.row + dy * d);
    const c = Math.round(ign.col + dx * d);
    if (r < 0 || c < 0 || r >= H || c >= W) break;
    dist = d;
    if (baseline.arrivalTime[r * W + c] >= target) break;
  }
  const cr = ign.row + dy * dist;
  const cc = ign.col + dx * dist;
  const half = BREAK_BUDGET_CELLS / 2;
  return {
    lines: [{ r1: Math.round(cr - dx * half), c1: Math.round(cc + dy * half), r2: Math.round(cr + dx * half), c2: Math.round(cc - dy * half) }],
    tMinutes,
    rationale: `One break across the wind, ${(dist * scenario.grid.cellSizeM / 1000).toFixed(1)} km downwind of the ignition.`,
  };
}

/** Compact text picture of the situation for the model. */
export function describe(scenario: Scenario, baseline: SimResult, homes: Uint16Array | undefined, previous: PlanAttempt[]): string {
  const { width: W, height: H, cellSizeM } = scenario.grid;
  const B = 10;
  const fuelChar: Record<number, string> = { [FuelClass.NONE]: '.', [FuelClass.GRASS]: 'G', [FuelClass.SHRUB]: 'S', [FuelClass.FOREST_DECIDUOUS]: 'F', [FuelClass.FOREST_CONIFER]: 'F', [FuelClass.FARMLAND]: 'A' };
  const fuelRows: string[] = [];
  const timeRows: string[] = [];
  for (let br = 0; br < H / B; br++) {
    let f = '';
    let t = '';
    for (let bc = 0; bc < W / B; bc++) {
      const counts = new Map<number, number>();
      let h = 0;
      let first = Infinity;
      for (let r = br * B; r < (br + 1) * B; r++) {
        for (let c = bc * B; c < (bc + 1) * B; c++) {
          const i = r * W + c;
          counts.set(scenario.fuel[i], (counts.get(scenario.fuel[i]) ?? 0) + 1);
          h += homes?.[i] ?? 0;
          first = Math.min(first, baseline.arrivalTime[i]);
        }
      }
      const major = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      f += h >= 5 ? 'H' : fuelChar[major] ?? '?';
      t += first === Infinity ? '-' : String(Math.min(9, Math.floor(first / 3600)));
    }
    fuelRows.push(f);
    timeRows.push(t);
  }
  const ign = scenario.ignition[0];
  const w = scenario.weather;
  const homesLine = homes ? `Homes reached by the fire with no plan: ${homesReached(baseline, homes, scenario.grid, scenario.durationSeconds)}.` : 'No building data for this area: minimise burned area.';
  const history = previous.map((a) =>
    `Plan ${a.n}: lines ${JSON.stringify(a.proposal.lines)} at ${a.proposal.tMinutes} min -> homes ${a.homesBefore} -> ${a.homesAfter}, burned ${a.areaBeforeHa.toFixed(0)} -> ${a.areaAfterHa.toFixed(0)} ha. ${a.accepted ? 'Accepted.' : 'Rejected.'}`,
  );
  return [
    'You are helping a wildfire incident commander place firebreaks. A physics-style simulator will test your plan; only a plan that cuts homes reached (or burned area) by at least 25 % is accepted.',
    `Grid: ${W} x ${H} cells of ${cellSizeM} m. Row 0 is north, column 0 is west.`,
    `Ignition at row ${ign.row}, col ${ign.col}. Wind from ${Math.round(w.windFromDeg)} degrees at ${Math.round(w.windSpeedMps * 3.6)} km/h (fire is pushed toward ${Math.round(windTowardDeg(w.windFromDeg))} degrees). Humidity ${Math.round(w.relativeHumidity * 100)} %, ${Math.round(w.temperatureC)} C.`,
    `Simulated duration: ${(scenario.durationSeconds / 3600).toFixed(0)} h. ${homesLine}`,
    `Rules: at most ${MAX_LINES} straight firebreak lines, total length at most ${BREAK_BUDGET_CELLS} cells, each ${BREAK_WIDTH_CELLS} cells wide. Crews arrive at ${EARLIEST_MINUTES} minutes at the earliest (t_minutes >= ${EARLIEST_MINUTES}). A break only works where the fire has not arrived yet at that time, and the fire can go around the ends.`,
    `Map in ${B} x ${B} cell blocks (block row i covers rows ${B}i..${B}i+${B - 1}). F forest, S shrub, G grass, A farmland, . non-burnable, H 5+ homes:`,
    ...fuelRows,
    'Hour the fire first reaches each block with no plan (0-9, - never):',
    ...timeRows,
    ...(history.length ? ['Previous attempts, verified by the simulator:', ...history, 'Propose a different plan that does better.'] : []),
    'Answer with JSON: {"lines":[{"r1":..,"c1":..,"r2":..,"c2":..}],"t_minutes":..,"rationale":"one sentence"}. Use cell coordinates (not blocks).',
  ].join('\n');
}

async function askGemini(prompt: string, opts: PlannerOptions): Promise<Proposal> {
  const model = opts.model || 'gemini-2.5-flash';
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey ?? '' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            lines: {
              type: 'ARRAY',
              items: { type: 'OBJECT', properties: { r1: { type: 'INTEGER' }, c1: { type: 'INTEGER' }, r2: { type: 'INTEGER' }, c2: { type: 'INTEGER' } }, required: ['r1', 'c1', 'r2', 'c2'] },
            },
            t_minutes: { type: 'INTEGER' },
            rationale: { type: 'STRING' },
          },
          required: ['lines', 't_minutes', 'rationale'],
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini request failed (HTTP ${res.status}). Check VITE_GEMINI_API_KEY and VITE_GEMINI_MODEL.`);
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no plan.');
  const parsed = JSON.parse(text) as { lines?: PlanLine[]; t_minutes?: number; rationale?: string };
  return { lines: parsed.lines ?? [], tMinutes: parsed.t_minutes ?? EARLIEST_MINUTES, rationale: parsed.rationale ?? '' };
}
