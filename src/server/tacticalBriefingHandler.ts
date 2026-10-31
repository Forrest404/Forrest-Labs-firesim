/**
 * AGENT 3 — Server-Side Gemini Tactic Selection & Clipped Wildfire Radio Script Agent.
 * Calls @google/genai (`gemini-3.8-flash`) on the server with structured JSON output,
 * and falls back gracefully if GEMINI_API_KEY is unset or unreachable.
 */

import { GoogleGenAI, Type } from '@google/genai';
import type { TacticalBriefingRequest, TacticalBriefingResponse, TacticType } from '../agent/types';

export function buildFallbackBriefing(req: TacticalBriefingRequest): TacticalBriefingResponse {
  const wave1Count = req.orders.filter((o) => o.wave === 1).length;
  const wave2Count = req.orders.filter((o) => o.wave === 2).length;
  const firebreakCount = req.orders.filter((o) => o.tacticType === 'firebreak').length;
  const waterCount = req.orders.length - firebreakCount;
  const totalDeforestedHa =
    req.totalDeforestedHa ??
    Number(
      req.orders
        .reduce((acc, o) => acc + (o.tacticType === 'firebreak' ? (o.deforestedHa ?? 0) : 0), 0)
        .toFixed(2),
    );
  const totalWaterLiters =
    req.totalWaterDroppedLiters ?? waterCount * 2500;

  const dipNote = req.dipSiteLabel
    ? ` Wave 2 refills 2,500L at ${req.dipSiteLabel}.`
    : '';

  const commanderBriefing =
    `Command Net (${req.areaLabel}): Wind toward ${Math.round(req.windTowardDeg)}° at ${Math.round(req.windSpeedKmh)} km/h (${Math.round(req.relativeHumidityPct)}% RH). ` +
    `Deploying ${wave1Count} Wave-1 & ${wave2Count} Wave-2 orders at 55 km/h (${waterCount} × 2,500L Water Sprays [${totalWaterLiters.toLocaleString()}L total], ${firebreakCount} Surgical Fire Breaks [${totalDeforestedHa.toFixed(2)} ha trees cut]) reduces burn from ${req.baselineBurnedHa.toFixed(1)} ha to ${req.projectedBurnedHa.toFixed(1)} ha—saving ${req.savedHa.toFixed(1)} ha (${req.reductionPct.toFixed(1)}%) with minimal deforestation.${dipNote}`;

  const orderRationales = req.orders.map((o) => {
    const wSaved = o.waterSavedHa ?? o.marginalSavedHa;
    const fbSaved = o.firebreakSavedHa ?? o.marginalSavedHa;
    const deforestedHa = o.deforestedHa ?? 0.25;
    const waterLiters = o.waterDropLiters ?? 2500;
    const extraSpreadIfNoCut = Math.max(0, fbSaved - wSaved);

    // Retrained policy: only cut trees when not doing so causes fire to spread more than the deforestation cost
    const tactic: TacticType =
      o.tacticType ??
      (extraSpreadIfNoCut > Math.max(0.15, deforestedHa) ? 'firebreak' : 'water');

    const crewName = o.crewLeadName ?? 'Sarah Miller';
    const stationLabel = o.stationCallLabel ?? 'Station 14';
    const callsign = o.callsign ?? o.unitName;
    const fuel = o.dominantFuelLabel ?? 'brush fuel';

    const tacticRationale =
      tactic === 'firebreak'
        ? `Cutting ${deforestedHa.toFixed(2)} ha of ${fuel} prevents +${extraSpreadIfNoCut.toFixed(1)} ha of breakaway fire spread (-${fbSaved.toFixed(1)} ha vs ${waterLiters}L Water -${wSaved.toFixed(1)} ha).`
        : `${waterLiters}L fire-truck water spray holds ${fuel} (-${wSaved.toFixed(1)} ha) with 0 ha deforestation (spares canopy; firebreak -${fbSaved.toFixed(1)} ha).`;

    const dispatchTranscript =
      o.wave === 2 && o.sourceType === 'dip_site'
        ? `This is ${crewName} calling from ${stationLabel} — ${waterLiters}L tank refilled, inbound to ${o.sectorLabel}. ${
            tactic === 'firebreak' ? 'Cutting emergency containment line' : `Laying Wave 2 ${waterLiters}L water spray`
          }, ETA ${o.etaMinutes} min.`
        : `This is ${crewName} calling from ${stationLabel} — rolling ${callsign} at 55 km/h to ${o.sectorLabel}. ${
            tactic === 'firebreak'
              ? `Cutting surgical firebreak in ${fuel} to prevent wider spread`
              : `Spraying ${waterLiters}L water knockdown on ${fuel} (0 trees cut)`
          }, ETA ${o.etaMinutes} min.`;

    const executingTranscript =
      tactic === 'firebreak'
        ? `${crewName}, ${stationLabel} on ${o.sectorLabel} — cutting minimal-footprint firebreak line now.`
        : `${crewName}, ${stationLabel} on ${o.sectorLabel} — pumping ${waterLiters}L water spray now, preserving trees.`;

    const refillTranscript =
      o.wave === 2 && o.sourceType === 'dip_site'
        ? `This is ${crewName} calling from ${stationLabel} — Wave 1 tank dry, refilling ${waterLiters}L at ${req.dipSiteLabel ?? 'river dip site'} for Wave 2.`
        : undefined;

    return {
      id: o.id,
      rationale: tacticRationale,
      selectedTactic: tactic,
      tacticRationale,
      dispatchTranscript,
      executingTranscript,
      refillTranscript,
    };
  });

  return {
    commanderBriefing,
    orderRationales,
    source: 'fallback',
  };
}

let invalidKeyDetected = false;

function isLikelyValidGeminiKey(key: string | undefined): key is string {
  if (!key) return false;
  const trimmed = key.trim();
  if (!trimmed || trimmed === 'MY_GEMINI_API_KEY' || trimmed === 'YOUR_API_KEY') return false;
  return trimmed.startsWith('AIza') && trimmed.length >= 30;
}

export async function generateTacticalBriefing(
  req: TacticalBriefingRequest,
): Promise<TacticalBriefingResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (invalidKeyDetected || !isLikelyValidGeminiKey(apiKey)) {
    return buildFallbackBriefing(req);
  }

  try {
    const ai = new GoogleGenAI({
      apiKey: apiKey.trim(),
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const prompt = `You are a Wildfire Incident Commander and Conservation-Aware Tactic Selection Agent running a live wildfire radio net for ${req.areaLabel}.
Weather: Wind toward ${Math.round(req.windTowardDeg)}° at ${Math.round(req.windSpeedKmh)} km/h, Temp ${req.temperatureC}°C, RH ${Math.round(req.relativeHumidityPct)}%.
Fleet Calibration: All units move at average fire truck speed (55 km/h) and carry average fire truck water capacity (2,500 L).
Baseline Burn: ${req.baselineBurnedHa.toFixed(1)} ha -> Projected Burn: ${req.projectedBurnedHa.toFixed(1)} ha (${req.savedHa.toFixed(1)} ha saved, ${req.reductionPct.toFixed(1)}%, Deforestation: ${(req.totalDeforestedHa ?? 0).toFixed(2)} ha).
Dip Site: ${req.dipSiteLabel ?? 'None'}.
Dispatch Orders with Counterfactual Water vs. Firebreak Simulation Results:
${JSON.stringify(req.orders, null, 2)}

Rules:
1. "commanderBriefing": Short, sharp 2-sentence Incident Command summary (max 50 words) highlighting area saved and minimal deforestation.
2. For each order in "orderRationales":
   - "selectedTactic": MUST be "water" (2,500L spray, 0 deforestation) UNLESS not cutting trees would lead to the fire spreading more than the trees felled (firebreakSavedHa - waterSavedHa > deforestedHa), in which case choose "firebreak".
   - "rationale": Short, sharp 1-line tactical explanation (max 18 words) stating why Water Spray spared trees or why Fire Break was strictly needed to prevent wider spread.
   - "dispatchTranscript": MUST begin with exact phrase "This is <crewLeadName> calling from <stationCallLabel> —" followed by a short, urgent radio callout of their target sector, tactic, and ETA (max 24 words).
   - "executingTranscript": Short, clipped arrival callout from <crewLeadName> at <stationCallLabel> as they begin pumping 2,500L water or cutting a surgical firebreak (max 16 words).
   - "refillTranscript": For Wave 2 dip_site orders, short radio callout announcing refilling 2,500L at the river before Wave 2 (max 18 words).`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        systemInstruction:
          'You are a decisive, clipped Wildfire Tactical Dispatcher. Keep all radio callouts short, sharp, and urgent like a live wildfire radio channel. Every dispatchTranscript MUST begin with "This is <crewLeadName> calling from <stationCallLabel>".',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            commanderBriefing: {
              type: Type.STRING,
              description: 'Short, sharp 2-sentence Incident Commander briefing.',
            },
            orderRationales: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  selectedTactic: { type: Type.STRING },
                  rationale: { type: Type.STRING },
                  dispatchTranscript: { type: Type.STRING },
                  executingTranscript: { type: Type.STRING },
                  refillTranscript: { type: Type.STRING },
                },
                required: ['id', 'selectedTactic', 'rationale', 'dispatchTranscript', 'executingTranscript'],
              },
            },
          },
          required: ['commanderBriefing', 'orderRationales'],
        },
      },
    });

    const rawText = (response.text ?? '').trim();
    if (!rawText) return buildFallbackBriefing(req);
    const parsed = JSON.parse(rawText) as {
      commanderBriefing?: string;
      orderRationales?: {
        id: string;
        selectedTactic?: string;
        rationale: string;
        dispatchTranscript?: string;
        executingTranscript?: string;
        refillTranscript?: string;
      }[];
    };

    if (!parsed.commanderBriefing || !Array.isArray(parsed.orderRationales)) {
      return buildFallbackBriefing(req);
    }

    return {
      commanderBriefing: parsed.commanderBriefing,
      orderRationales: parsed.orderRationales.map((r) => ({
        id: r.id,
        rationale: r.rationale,
        selectedTactic: r.selectedTactic === 'firebreak' ? 'firebreak' : 'water',
        tacticRationale: r.rationale,
        dispatchTranscript: r.dispatchTranscript,
        executingTranscript: r.executingTranscript,
        refillTranscript: r.refillTranscript,
      })),
      source: 'gemini',
    };
  } catch {
    invalidKeyDetected = true;
    return buildFallbackBriefing(req);
  }
}
