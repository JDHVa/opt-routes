import silhouetteData from "@/data/silhouettes.json";
import type { PresetId as ObjectivePresetId } from "@/lib/planner/presets";

export const START_PRESET_IDS = [
  "fast-center",
  "mixed-fleet",
  "multi-origin",
  "urgent-windows",
  "pareto-tradeoff",
  "live-day",
] as const;

export type StartPresetId = (typeof START_PRESET_IDS)[number];
export type StartPresetTarget = "planner" | "pareto" | "simulate";

export type StartPreset = {
  id: StartPresetId;
  target: StartPresetTarget;
  scenarioId: string;
  algorithm: string;
  objective: ObjectivePresetId | null;
  timeLimitS: number;
};

export const START_PRESETS: readonly StartPreset[] = [
  {
    id: "fast-center",
    target: "planner",
    scenarioId: "mty-centro-depot-40",
    algorithm: "ga",
    objective: "fastest",
    timeLimitS: 10,
  },
  {
    id: "mixed-fleet",
    target: "planner",
    scenarioId: "mty-metro-depot-150",
    algorithm: "aco_ga",
    objective: "balanced",
    timeLimitS: 20,
  },
  {
    id: "multi-origin",
    target: "planner",
    scenarioId: "mty-multiorigin-80",
    algorithm: "aco",
    objective: "cheapest",
    timeLimitS: 15,
  },
  {
    id: "urgent-windows",
    target: "planner",
    scenarioId: "mty-urgent-tw-120",
    algorithm: "ga",
    objective: "fastest",
    timeLimitS: 15,
  },
  {
    id: "pareto-tradeoff",
    target: "pareto",
    scenarioId: "mty-motos-60",
    algorithm: "nsga2",
    objective: null,
    timeLimitS: 15,
  },
  {
    id: "live-day",
    target: "simulate",
    scenarioId: "mty-dynamic-100",
    algorithm: "ga",
    objective: null,
    timeLimitS: 5,
  },
];

export const PRESET_QUERY_PARAM = "preset";

export function findStartPreset(id: string | null | undefined): StartPreset | null {
  if (!id) return null;
  return START_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function presetHref(preset: StartPreset): string {
  return `/${preset.target}?${PRESET_QUERY_PARAM}=${preset.id}`;
}

export function presetsFor(target: StartPresetTarget): StartPreset[] {
  return START_PRESETS.filter((preset) => preset.target === target);
}

export type Silhouette = {
  stops: [number, number][];
  depot: [number, number] | null;
  origins: [number, number][];
};

export type SilhouetteSet = {
  width: number;
  height: number;
  scenarios: Record<string, Silhouette>;
};

export const SILHOUETTES = silhouetteData as unknown as SilhouetteSet;

export function silhouetteFor(scenarioId: string): Silhouette | null {
  return SILHOUETTES.scenarios[scenarioId] ?? null;
}
