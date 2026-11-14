import type {
  CompareEntry,
  HistoryPoint,
  Solution,
  SolutionMetrics,
  SolverStage,
} from "@/lib/api/types";

export type RunStatus = "pending" | "running" | "done";

export type RunProgress = {
  iteration: number;
  elapsedS: number;
  bestFitness: number;
  stage: SolverStage | null;
};

export type RunState = {
  index: number;
  algorithm: string;
  status: RunStatus;
  progress: RunProgress | null;
  liveMetrics: SolutionMetrics | null;
  liveSolution: Solution | null;
  history: HistoryPoint[];
  entry: CompareEntry | null;
};

export type MetricKey =
  | "cost"
  | "duration"
  | "makespan"
  | "vehicles"
  | "distance"
  | "gap"
  | "runtime";

export type SortKey = "algorithm" | MetricKey | "feasible";
export type SortDirection = "asc" | "desc";

export type CompareRow = {
  index: number;
  algorithm: string;
  status: RunStatus;
  cost: number | null;
  duration: number | null;
  makespan: number | null;
  vehicles: number | null;
  distance: number | null;
  gap: number | null;
  runtime: number | null;
  feasible: boolean | null;
};

export const METRIC_KEYS: MetricKey[] = [
  "cost",
  "duration",
  "makespan",
  "vehicles",
  "distance",
  "gap",
  "runtime",
];

export function emptyRun(index: number, algorithm: string): RunState {
  return {
    index,
    algorithm,
    status: "pending",
    progress: null,
    liveMetrics: null,
    liveSolution: null,
    history: [],
    entry: null,
  };
}

function bestFitness(runs: RunState[]): number | null {
  const fitnesses = runs
    .filter((run) => run.entry !== null)
    .map((run) => run.entry?.solution.metrics.fitness ?? Infinity);
  return fitnesses.length > 0 ? Math.min(...fitnesses) : null;
}

export function buildRows(runs: RunState[]): CompareRow[] {
  const best = bestFitness(runs);
  return runs.map((run) => {
    const metrics = run.entry?.solution.metrics ?? run.liveMetrics;
    let gap: number | null = null;
    if (run.entry) {
      if (run.entry.gap_pct !== undefined && run.entry.gap_pct !== null) {
        gap = run.entry.gap_pct;
      } else if (best !== null && best > 0) {
        gap = ((run.entry.solution.metrics.fitness - best) / best) * 100;
      }
    }
    return {
      index: run.index,
      algorithm: run.algorithm,
      status: run.status,
      cost: metrics?.total_cost_mxn ?? null,
      duration: metrics?.total_duration_min ?? null,
      makespan: metrics?.makespan_min ?? null,
      vehicles: metrics?.vehicles_used ?? null,
      distance: metrics?.total_distance_km ?? null,
      gap,
      runtime: run.entry?.solution.runtime_s ?? run.progress?.elapsedS ?? null,
      feasible: metrics ? metrics.feasible : null,
    };
  });
}

function sortValue(row: CompareRow, key: SortKey): number | string | null {
  if (key === "algorithm") return row.algorithm;
  if (key === "feasible") return row.feasible === null ? null : Number(row.feasible);
  return row[key];
}

export function sortRows(
  rows: CompareRow[],
  key: SortKey,
  direction: SortDirection,
): CompareRow[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = sortValue(a, key);
    const right = sortValue(b, key);
    if (left === null && right === null) return a.index - b.index;
    if (left === null) return 1;
    if (right === null) return -1;
    if (left === right) return a.index - b.index;
    if (typeof left === "string" && typeof right === "string") {
      return sign * left.localeCompare(right);
    }
    return sign * (Number(left) - Number(right));
  });
}

export function bestCells(rows: CompareRow[]): Record<MetricKey, Set<number>> {
  const result = Object.fromEntries(METRIC_KEYS.map((key) => [key, new Set<number>()])) as Record<
    MetricKey,
    Set<number>
  >;
  const finished = rows.filter((row) => row.status === "done");
  if (finished.length < 2) return result;
  for (const key of METRIC_KEYS) {
    const values = finished
      .map((row) => ({ index: row.index, value: row[key] }))
      .filter((cell): cell is { index: number; value: number } => cell.value !== null);
    if (values.length < 2) continue;
    const best = Math.min(...values.map((cell) => cell.value));
    for (const cell of values) {
      if (cell.value === best) result[key].add(cell.index);
    }
  }
  return result;
}

export function nextDirection(
  current: { key: SortKey; direction: SortDirection } | null,
  key: SortKey,
): { key: SortKey; direction: SortDirection } {
  if (current && current.key === key) {
    return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { key, direction: "asc" };
}
