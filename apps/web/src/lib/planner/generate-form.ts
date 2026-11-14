import { z } from "zod";
import type { GenerateRequest, ProblemMode } from "@/lib/api/types";

export type GenerateFormValues = {
  nStops: number | null;
  nDrivers: number | null;
  mode: ProblemMode;
  timeWindowsPct: number | null;
  highPriorityPct: number | null;
  dynamicPct: number | null;
  seed: number | null;
};

export const GENERATE_DEFAULTS: GenerateFormValues = {
  nStops: 60,
  nDrivers: 6,
  mode: "depot",
  timeWindowsPct: 30,
  highPriorityPct: 10,
  dynamicPct: 0,
  seed: 1,
};

export type GenerateErrorCode = "required" | "integer" | "min" | "max";
export type GenerateFieldKey = keyof Omit<GenerateFormValues, "mode">;
export type GenerateErrors = Partial<
  Record<GenerateFieldKey, { code: GenerateErrorCode; bound?: number }>
>;

type Bounds = { min: number; max: number; integer: boolean };

export const GENERATE_BOUNDS: Record<GenerateFieldKey, Bounds> = {
  nStops: { min: 2, max: 250, integer: true },
  nDrivers: { min: 1, max: 30, integer: true },
  timeWindowsPct: { min: 0, max: 100, integer: false },
  highPriorityPct: { min: 0, max: 100, integer: false },
  dynamicPct: { min: 0, max: 100, integer: false },
  seed: { min: 0, max: 2_147_483_647, integer: true },
};

function check(
  value: number | null,
  bounds: Bounds,
): { code: GenerateErrorCode; bound?: number } | null {
  if (value === null || !Number.isFinite(value)) return { code: "required" };
  if (bounds.integer && !Number.isInteger(value)) return { code: "integer" };
  if (value < bounds.min) return { code: "min", bound: bounds.min };
  if (value > bounds.max) return { code: "max", bound: bounds.max };
  return null;
}

export function validateGenerate(values: GenerateFormValues): GenerateErrors {
  const errors: GenerateErrors = {};
  for (const key of Object.keys(GENERATE_BOUNDS) as GenerateFieldKey[]) {
    const problem = check(values[key], GENERATE_BOUNDS[key]);
    if (problem) errors[key] = problem;
  }
  return errors;
}

const requestSchema = z.object({
  n_stops: z.number().int().min(2).max(250),
  n_drivers: z.number().int().min(1).max(30),
  mode: z.enum(["depot", "multi_origin"]),
  time_windows_pct: z.number().min(0).max(1),
  high_priority_pct: z.number().min(0).max(1),
  dynamic_pct: z.number().min(0).max(1),
  seed: z.number().int(),
});

export function toGenerateRequest(values: GenerateFormValues): GenerateRequest | null {
  if (Object.keys(validateGenerate(values)).length > 0) return null;
  const parsed = requestSchema.safeParse({
    n_stops: values.nStops,
    n_drivers: values.nDrivers,
    mode: values.mode,
    time_windows_pct: (values.timeWindowsPct ?? 0) / 100,
    high_priority_pct: (values.highPriorityPct ?? 0) / 100,
    dynamic_pct: (values.dynamicPct ?? 0) / 100,
    seed: values.seed,
  });
  return parsed.success ? parsed.data : null;
}
