import type { ObjectiveWeights } from "@/lib/api/types";

export const PRESET_IDS = ["fastest", "cheapest", "fewest", "balanced"] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export const PRESET_WEIGHTS: Record<PresetId, ObjectiveWeights> = {
  fastest: { time: 0.2, cost: 0.1, vehicles: 0, makespan: 1 },
  cheapest: { time: 0.2, cost: 1, vehicles: 0.1, makespan: 0 },
  fewest: { time: 0.1, cost: 0.3, vehicles: 1, makespan: 0 },
  balanced: { time: 0.5, cost: 0.5, vehicles: 0.25, makespan: 0.25 },
};

const KEYS = ["time", "cost", "vehicles", "makespan"] as const;

export function normalizeWeights(weights: ObjectiveWeights): ObjectiveWeights {
  const total = KEYS.reduce((sum, key) => sum + Math.max(0, weights[key]), 0);
  if (total <= 0) return { time: 0.25, cost: 0.25, vehicles: 0.25, makespan: 0.25 };
  return {
    time: Math.max(0, weights.time) / total,
    cost: Math.max(0, weights.cost) / total,
    vehicles: Math.max(0, weights.vehicles) / total,
    makespan: Math.max(0, weights.makespan) / total,
  };
}

export function presetToWeights(preset: PresetId): ObjectiveWeights {
  return { ...PRESET_WEIGHTS[preset] };
}

export function detectPreset(weights: ObjectiveWeights): PresetId | null {
  const target = normalizeWeights(weights);
  for (const id of PRESET_IDS) {
    const candidate = normalizeWeights(PRESET_WEIGHTS[id]);
    const close = KEYS.every((key) => Math.abs(candidate[key] - target[key]) < 0.02);
    if (close) return id;
  }
  return null;
}
