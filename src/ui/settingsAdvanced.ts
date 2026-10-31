/**
 * Advanced settings. Presets fill these values; editing any of them makes the dryness select
 * show "Custom". Unimplemented knobs are disabled and labelled "coming soon".
 */

import { deriveFuelMoisture } from '../contract';
import type { RateModelId, SimSettings, Weather } from '../contract';
import { staleIfResult } from '../app/state';
import type { Store } from '../app/state';
import { el } from './el';
import { UNIT_TYPES, resolveLevel } from '../contain';
import type { ContainOverrides, UnitType } from '../contain';
import { STR } from './strings';

interface NumField {
  label: string;
  min: number;
  max: number;
  step: number;
  get(s: { weather: Weather; settings: SimSettings; seed: number }): number;
  set(v: number, s: { weather: Weather; settings: SimSettings }): { weather?: Weather; settings?: SimSettings; seed?: number };
  unit?: string;
}

const FIELDS: NumField[] = [
  { label: STR.advIsoSpeed, min: 0.01, max: 2, step: 0.01, unit: 'm/s', get: (s) => s.settings.isoSpeedMps,
    set: (v, s) => ({ settings: { ...s.settings, isoSpeedMps: v } }) },
  { label: STR.advTemperature, min: -10, max: 50, step: 1, unit: '°C', get: (s) => s.weather.temperatureC,
    set: (v, s) => ({ weather: { ...s.weather, temperatureC: v, baseFuelMoisture: deriveFuelMoisture(v, s.weather.relativeHumidity) } }) },
  { label: STR.advHumidity, min: 1, max: 100, step: 1, unit: '%', get: (s) => Math.round(s.weather.relativeHumidity * 100),
    set: (v, s) => ({ weather: { ...s.weather, relativeHumidity: v / 100, baseFuelMoisture: deriveFuelMoisture(s.weather.temperatureC, v / 100) } }) },
  { label: STR.advFuelMoisture, min: 2, max: 40, step: 0.5, unit: '%', get: (s) => Math.round(s.weather.baseFuelMoisture * 1000) / 10,
    set: (v, s) => ({ weather: { ...s.weather, baseFuelMoisture: v / 100 } }) },
  { label: STR.advWindVariability, min: 0, max: 45, step: 1, unit: '°', get: (s) => s.weather.windVariabilityDeg ?? 0,
    set: (v, s) => ({ weather: { ...s.weather, windVariabilityDeg: v } }) },
  { label: STR.advSpreadMultiplier, min: 0.25, max: 4, step: 0.05, unit: '×', get: (s) => s.settings.globalMultiplier,
    set: (v, s) => ({ settings: { ...s.settings, globalMultiplier: v } }) },
  { label: STR.advWindStrength, min: 0, max: 2, step: 0.05, unit: '×', get: (s) => s.settings.windStrength,
    set: (v, s) => ({ settings: { ...s.settings, windStrength: v } }) },
  { label: STR.advSlopeStrength, min: 0, max: 2, step: 0.05, unit: '×', get: (s) => s.settings.slopeStrength,
    set: (v, s) => ({ settings: { ...s.settings, slopeStrength: v } }) },
  { label: STR.advWaterHalfLife, min: 1, max: 120, step: 1, unit: 'min', get: (s) => Math.round(s.settings.waterHalfLifeS / 60),
    set: (v, s) => ({ settings: { ...s.settings, waterHalfLifeS: v * 60 } }) },
  { label: STR.advWaterBoost, min: 5, max: 100, step: 5, unit: '%', get: (s) => Math.round(s.settings.waterMoistureBoost * 100),
    set: (v, s) => ({ settings: { ...s.settings, waterMoistureBoost: v / 100 } }) },
  { label: STR.advSeed, min: 0, max: 2 ** 31 - 1, step: 1, get: (s) => s.seed, set: (v) => ({ seed: Math.round(v) }) },
];

export function mountSettingsAdvanced(container: HTMLElement, store: Store): void {
  const details = el('details', {}, el('summary', {}, STR.advancedTitle)) as HTMLDetailsElement;
  details.ontoggle = () => store.set({ advancedOpen: details.open });
  const model = el('select', { 'aria-label': STR.advModel },
    el('option', { value: 'factors' }, STR.modelFactors),
    el('option', { value: 'rothermel' }, STR.modelRothermel),
    el('option', { value: 'iso' }, STR.modelIso),
  ) as HTMLSelectElement;
  model.onchange = () => store.update((s) => ({ settings: { ...s.settings, rateModel: model.value as RateModelId }, ...staleIfResult(s) }));
  details.append(el('label', {}, el('span', {}, STR.advModel), model), el('div', { class: 'muted' }, STR.modelNote));
  const inputs: HTMLInputElement[] = [];
  for (const f of FIELDS) {
    const input = el('input', { type: 'number', min: f.min, max: f.max, step: f.step }) as HTMLInputElement;
    input.onchange = () => {
      const v = Math.min(f.max, Math.max(f.min, Number(input.value)));
      if (!Number.isFinite(v)) return;
      store.update((s) => ({ ...f.set(v, s), ...staleIfResult(s) }));
    };
    inputs.push(input);
    details.append(el('label', {}, el('span', {}, f.label), el('span', { class: 'num' }, input, f.unit ? el('span', { class: 'unit' }, f.unit) : null)));
  }
  const burnout = el('input', { type: 'checkbox' }) as HTMLInputElement;
  burnout.onchange = () => store.update((s) => ({ settings: { ...s.settings, burnoutEnabled: burnout.checked }, ...staleIfResult(s) }));
  details.append(el('label', {}, el('span', {}, STR.advBurnout), burnout));
  for (const label of [STR.advGridSize, STR.advSpotting, STR.advCrownFire, STR.advTimeVaryingWeather]) {
    details.append(el('label', { class: 'disabled', title: STR.comingSoon }, el('span', {}, `${label} — ${STR.comingSoon}`), el('input', { type: 'checkbox', disabled: true })));
  }
  // Emergency response overrides on top of the chosen preset (src/contain).
  const setOverride = (patch: ContainOverrides): void =>
    store.update((s) => ({ contain: { ...s.contain, overrides: { ...s.contain.overrides, ...patch, roster: { ...s.contain.overrides?.roster, ...patch.roster } } }, ...staleIfResult(s) }));
  const respNum = (label: string, min: number, max: number, step: number, unit: string | undefined, get: (r: ReturnType<typeof resolveLevel>) => number, set: (v: number) => ContainOverrides): HTMLInputElement => {
    const input = el('input', { type: 'number', min, max, step }) as HTMLInputElement;
    input.onchange = () => {
      const v = Math.min(max, Math.max(min, Number(input.value)));
      if (Number.isFinite(v)) setOverride(set(v));
    };
    respInputs.push({ input, get });
    details.append(el('label', {}, el('span', {}, label), el('span', { class: 'num' }, input, unit ? el('span', { class: 'unit' }, unit) : null)));
    return input;
  };
  const respInputs: { input: HTMLInputElement; get: (r: ReturnType<typeof resolveLevel>) => number }[] = [];
  details.append(el('div', { class: 'sub-title' }, STR.advResponse));
  respNum(STR.advRespDelay, 0, 120, 1, 'min', (r) => Math.round(r.delayS / 60), (v) => ({ delayS: v * 60 }));
  respNum(STR.advRespCycles, 1, 8, 1, undefined, (r) => r.cycles, (v) => ({ cycles: Math.round(v) }));
  respNum(STR.advRespBudget, 60, 3000, 30, 'm', (r) => r.lineBudgetM, (v) => ({ lineBudgetM: v }));
  for (const t of UNIT_TYPES) respNum(STR.advRespUnits[t], 0, 8, 1, undefined, (r) => r.roster[t], (v) => ({ roster: { [t]: Math.round(v) } as Partial<Record<UnitType, number>> }));
  const respReset = el('button', { type: 'button', class: 'ghost', onclick: () => store.update((s) => ({ contain: { ...s.contain, overrides: null }, ...staleIfResult(s) })) }, STR.advRespReset) as HTMLButtonElement;
  details.append(respReset);
  details.append(el('div', { class: 'muted' }, STR.advancedNote));
  container.append(details);

  // TODO(settings-polish): inline validation messages, units toggle (km/h / mph), reset-to-preset
  // button, and surfacing the per-fuel multipliers from fuels.ts.
  store.subscribe((s) => {
    FIELDS.forEach((f, i) => {
      if (document.activeElement !== inputs[i]) inputs[i].value = String(f.get(s));
    });
    burnout.checked = s.settings.burnoutEnabled;
    model.value = s.settings.rateModel;
    const resolved = resolveLevel(s.contain.level, s.contain.overrides);
    for (const r of respInputs) if (document.activeElement !== r.input) r.input.value = String(r.get(resolved));
    respReset.disabled = !s.contain.overrides;
    if (details.open !== s.advancedOpen) details.open = s.advancedOpen;
  });
}
