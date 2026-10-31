/**
 * Advanced settings. Presets fill these values; editing any of them makes the dryness select
 * show "Custom". Unimplemented knobs are disabled and labelled "coming soon".
 */

import { deriveFuelMoisture } from '../contract';
import type { RateModelId, SimSettings, Weather } from '../contract';
import { staleIfResult } from '../app/state';
import type { Store } from '../app/state';
import { el } from './el';
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
  { label: STR.advSpotThreshold, min: 100, max: 20000, step: 100, unit: 'kW/m', get: (s) => s.settings.spottingIntensityKwM,
    set: (v, s) => ({ settings: { ...s.settings, spottingIntensityKwM: v } }) },
  { label: STR.advSpotEmbers, min: 0, max: 8, step: 1, get: (s) => s.settings.spottingEmbers,
    set: (v, s) => ({ settings: { ...s.settings, spottingEmbers: Math.round(v) } }) },
  { label: STR.advSpotRange, min: 0.25, max: 4, step: 0.25, unit: '×', get: (s) => s.settings.spottingRangeScale,
    set: (v, s) => ({ settings: { ...s.settings, spottingRangeScale: v } }) },
  { label: STR.advSpotProb, min: 0, max: 100, step: 5, unit: '%', get: (s) => Math.round(s.settings.spottingIgnitionProb * 100),
    set: (v, s) => ({ settings: { ...s.settings, spottingIgnitionProb: v / 100 } }) },
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
  const round = el('input', { type: 'checkbox' }) as HTMLInputElement;
  round.onchange = () => store.update((s) => ({ settings: { ...s.settings, neighbourhood: round.checked ? 16 : 8 }, ...staleIfResult(s) }));
  const spotting = el('input', { type: 'checkbox' }) as HTMLInputElement;
  spotting.onchange = () => store.update((s) => ({ settings: { ...s.settings, spottingEnabled: spotting.checked }, ...staleIfResult(s) }));
  details.append(el('label', {}, el('span', {}, STR.advSpotting), spotting), el('div', { class: 'muted' }, STR.spottingNote));
  details.append(el('label', {}, el('span', {}, STR.advRoundShape), round));
  details.append(el('label', {}, el('span', {}, STR.advBurnout), burnout));
  for (const label of [STR.advGridSize, STR.advCrownFire, STR.advTimeVaryingWeather]) {
    details.append(el('label', { class: 'disabled', title: STR.comingSoon }, el('span', {}, `${label} — ${STR.comingSoon}`), el('input', { type: 'checkbox', disabled: true })));
  }
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
    round.checked = s.settings.neighbourhood === 16;
    spotting.checked = s.settings.spottingEnabled;
    if (details.open !== s.advancedOpen) details.open = s.advancedOpen;
  });
}
