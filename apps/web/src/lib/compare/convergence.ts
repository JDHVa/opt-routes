import type { RunState } from "./table";

export type ConvergencePoint = { t: number } & Record<string, number | undefined>;

export type ConvergenceSeries = { key: string; index: number; algorithm: string };

export type Convergence = { data: ConvergencePoint[]; series: ConvergenceSeries[] };

export function seriesKey(index: number): string {
  return `run${index}`;
}

export function buildConvergence(runs: RunState[]): Convergence {
  const series: ConvergenceSeries[] = [];
  const byTime = new Map<number, ConvergencePoint>();
  for (const run of runs) {
    if (run.history.length === 0) continue;
    const key = seriesKey(run.index);
    series.push({ key, index: run.index, algorithm: run.algorithm });
    for (const point of run.history) {
      if (!Number.isFinite(point.best_fitness)) continue;
      const existing = byTime.get(point.elapsed_s) ?? { t: point.elapsed_s };
      existing[key] = point.best_fitness;
      byTime.set(point.elapsed_s, existing);
    }
  }
  const data = [...byTime.values()].sort((a, b) => a.t - b.t);
  return { data, series };
}

export function fitnessDomain(convergence: Convergence): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const point of convergence.data) {
    for (const { key } of convergence.series) {
      const value = point[key];
      if (value === undefined) continue;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  return Number.isFinite(min) ? { min, max } : null;
}

export const LOG_SUGGESTION_RATIO = 20;

export function suggestsLogScale(convergence: Convergence): boolean {
  const domain = fitnessDomain(convergence);
  return domain !== null && domain.min > 0 && domain.max / domain.min >= LOG_SUGGESTION_RATIO;
}
