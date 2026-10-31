/** "Suggest a plan" section: asks Gemini (or the built-in planner), shows every verified attempt. */

import { suggestPlan } from '../app/planner';
import type { PlanAttempt } from '../app/planner';
import type { Store } from '../app/state';
import type { Wiring } from '../app/wiring';
import { el } from './el';
import { STR } from './strings';

const env = import.meta.env as Record<string, string | undefined>;

export function mountPlanner(container: HTMLElement, store: Store, wiring: Wiring): void {
  const apiKey = env.VITE_GEMINI_API_KEY || undefined;
  const model = env.VITE_GEMINI_MODEL || undefined;
  const button = el('button', { class: 'primary', onclick: () => void run() }, apiKey ? STR.planButtonGemini : STR.planButtonBuiltin) as HTMLButtonElement;
  const note = el('div', { class: 'muted' }, apiKey ? STR.planNoteGemini : STR.planNoteBuiltin);
  const status = el('div', { class: 'muted' });
  const list = el('ul', { class: 'plan-attempts' });

  container.append(el('h2', {}, STR.planTitle), button, note, status, list);

  async function run(): Promise<void> {
    const scenario = wiring.buildScenario();
    if (typeof scenario === 'string') {
      store.set({ simError: scenario });
      return;
    }
    const area = store.get().area;
    const outcome = await suggestPlan(scenario, {
      apiKey,
      model,
      homes: area?.homes,
      onUpdate: (plan) => store.set({ plan }),
    });
    if (outcome.interventions.length) {
      // Replace earlier plan lines, keep anything the user drew by hand.
      const own = store.get().interventions.filter((iv) => !iv.id.startsWith('plan-'));
      store.set({ interventions: [...own, ...outcome.interventions], resultStale: !!store.get().result });
      await wiring.simulate();
    }
  }

  store.subscribe((s, prev) => {
    button.disabled = !s.area || !s.ignition || s.plan?.status === 'running';
    if (s.plan === prev.plan) return;
    const p = s.plan;
    status.textContent = !p ? '' : p.status === 'running' ? STR.planRunning : p.message;
    status.classList.toggle('error-text', p?.status === 'error');
    list.replaceChildren(...(p?.attempts ?? []).map(attemptItem));
  });
}

function attemptItem(a: PlanAttempt): HTMLElement {
  const homes = a.homesBefore > 0 ? `${STR.homes} ${a.homesBefore} → ${a.homesAfter}` : '';
  const area = `${STR.burned} ${a.areaBeforeHa.toFixed(0)} → ${a.areaAfterHa.toFixed(0)} ha`;
  return el('li', { class: a.accepted ? 'ok' : 'rejected' },
    el('strong', {}, `${a.accepted ? '✓' : '✗'} ${STR.planLabel} ${a.n} (${a.source === 'gemini' ? 'Gemini' : STR.builtin}): ${a.accepted ? STR.accepted : STR.rejected}`),
    el('div', {}, [homes, area].filter(Boolean).join(' · ')),
    a.proposal.rationale ? el('div', { class: 'muted' }, a.proposal.rationale) : false,
    a.note ? el('div', { class: 'muted' }, a.note) : false,
  );
}
