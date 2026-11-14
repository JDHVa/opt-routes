import type { Problem, SimulationConfig, TriggerMode } from "@/lib/api/types";

export const DEFAULT_SIM_SCENARIO = "mty-dynamic-100";

export type SimConfigForm = {
  scenarioId: string;
  algorithm: string;
  trigger: TriggerMode;
  batchMinutes: number | null;
  speed: number;
  reoptTimeLimitS: number | null;
  initialTimeLimitS: number | null;
};

export const SIM_FORM_DEFAULTS: SimConfigForm = {
  scenarioId: DEFAULT_SIM_SCENARIO,
  algorithm: "ga",
  trigger: "event",
  batchMinutes: 15,
  speed: 60,
  reoptTimeLimitS: 5,
  initialTimeLimitS: 10,
};

export type SimFieldKey = "batchMinutes" | "reoptTimeLimitS" | "initialTimeLimitS";
export type SimFormErrors = Partial<Record<SimFieldKey, "required" | "min" | "max">>;

const LIMITS: Record<SimFieldKey, { max: number }> = {
  batchMinutes: { max: 1440 },
  reoptTimeLimitS: { max: 60 },
  initialTimeLimitS: { max: 600 },
};

function check(value: number | null, max: number): "required" | "min" | "max" | null {
  if (value === null || !Number.isFinite(value)) return "required";
  if (value <= 0) return "min";
  if (value > max) return "max";
  return null;
}

export function validateSimForm(form: SimConfigForm): SimFormErrors {
  const errors: SimFormErrors = {};
  const keys: SimFieldKey[] =
    form.trigger === "batch"
      ? ["batchMinutes", "reoptTimeLimitS", "initialTimeLimitS"]
      : ["reoptTimeLimitS", "initialTimeLimitS"];
  for (const key of keys) {
    const problem = check(form[key], LIMITS[key].max);
    if (problem) errors[key] = problem;
  }
  return errors;
}

export function simFieldMax(key: SimFieldKey): number {
  return LIMITS[key].max;
}

export function toSimulationConfig(
  problem: Problem,
  form: SimConfigForm,
): SimulationConfig | null {
  if (Object.keys(validateSimForm(form)).length > 0) return null;
  return {
    problem,
    run: {
      algorithm: form.algorithm,
      params: { time_limit_s: form.initialTimeLimitS ?? SIM_FORM_DEFAULTS.initialTimeLimitS ?? 10 },
    },
    speed: form.speed,
    trigger: form.trigger,
    batch_minutes: form.batchMinutes ?? SIM_FORM_DEFAULTS.batchMinutes ?? 15,
    reopt_time_limit_s: form.reoptTimeLimitS ?? SIM_FORM_DEFAULTS.reoptTimeLimitS ?? 5,
  };
}
