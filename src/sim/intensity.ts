/**
 * Fire behaviour outputs derived from the spread rate.
 *
 * Byram (1959) fireline intensity: I = H * w * R, the heat released per metre of fire front per
 * second, with H the fuel heat content (J/kg), w the fuel consumed (kg/m^2, here the whole dead
 * fuel load) and R the spread rate (m/s). Divided by 1000 for kW/m.
 *
 * Byram (1959) flame length: L = 0.0775 * I^0.46 (m, I in kW/m).
 *
 * Both are indicative: they inherit every placeholder in the fuel table and rate model.
 */

export function byramIntensityKwM(heatContentJkg: number, loadKgM2: number, rateMps: number): number {
  if (!(rateMps > 0) || !(heatContentJkg > 0) || !(loadKgM2 > 0)) return 0;
  return (heatContentJkg * loadKgM2 * rateMps) / 1000;
}

export function flameLengthM(intensityKwM: number): number {
  return intensityKwM > 0 ? 0.0775 * Math.pow(intensityKwM, 0.46) : 0;
}

/**
 * Rule-of-thumb fireline-intensity classes commonly quoted in fire management (approximate; they
 * describe how hard a fire is to suppress, they are not a safety rating).
 */
export type IntensityClass = 'low' | 'moderate' | 'high' | 'extreme';

export function intensityClass(intensityKwM: number): IntensityClass {
  if (intensityKwM < 350) return 'low'; // hand crews can usually hold the line
  if (intensityKwM < 1700) return 'moderate'; // equipment needed
  if (intensityKwM < 3500) return 'high'; // direct attack at the head is generally ineffective
  return 'extreme'; // crowning, spotting and major runs become likely
}
