import type { SolutionMetrics } from "@/lib/api/types";

export type Infeasibility =
  | { kind: "unassigned"; amount: number }
  | { kind: "overloadKg"; amount: number }
  | { kind: "overloadM3"; amount: number }
  | { kind: "overtime"; amount: number };

export function infeasibilities(metrics: SolutionMetrics): Infeasibility[] {
  const issues: Infeasibility[] = [];
  if (metrics.unassigned > 0) issues.push({ kind: "unassigned", amount: metrics.unassigned });
  if (metrics.overload_kg > 0) issues.push({ kind: "overloadKg", amount: metrics.overload_kg });
  if (metrics.overload_m3 > 0) issues.push({ kind: "overloadM3", amount: metrics.overload_m3 });
  if (metrics.overtime_min > 0) issues.push({ kind: "overtime", amount: metrics.overtime_min });
  return issues;
}

export function isInfeasible(metrics: SolutionMetrics): boolean {
  return !metrics.feasible || infeasibilities(metrics).length > 0;
}
