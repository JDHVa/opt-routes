import { describe, expect, it } from "vitest";
import { parseCompareMessage } from "@/lib/api/client";
import type { CompareEntry, Solution, SolutionMetrics } from "@/lib/api/types";
import { applyCompareEvent, applyComplete, initialRuns, startRun } from "./reducer";
import { bestCells, buildRows, nextDirection, sortRows } from "./table";

function metrics(partial: Partial<SolutionMetrics>): SolutionMetrics {
  return {
    total_distance_km: 100,
    total_duration_min: 300,
    makespan_min: 120,
    vehicles_used: 4,
    total_cost_mxn: 1000,
    lateness_min: 0,
    overload_kg: 0,
    overload_m3: 0,
    overtime_min: 0,
    unassigned: 0,
    feasible: true,
    fitness: 1,
    ...partial,
  };
}

function entry(
  algorithm: string,
  partial: Partial<SolutionMetrics>,
  runtime = 5,
  gap: number | null = null,
): CompareEntry {
  const solution: Solution = {
    algorithm,
    routes: [],
    unassigned_stop_ids: [],
    metrics: metrics(partial),
    runtime_s: runtime,
  };
  return {
    run: { algorithm, params: {} },
    solution,
    history: [{ iteration: 1, elapsed_s: 0.5, best_fitness: partial.fitness ?? 1 }],
    gap_pct: gap,
  };
}

function finishedRuns() {
  let runs = initialRuns(["ga", "aco", "pyvrp"]);
  runs = applyCompareEvent(runs, {
    kind: "result",
    payload: { run_index: 0, ...entry("ga", { total_cost_mxn: 900, vehicles_used: 5, fitness: 1.1 }, 8) },
  });
  runs = applyCompareEvent(runs, {
    kind: "result",
    payload: { run_index: 1, ...entry("aco", { total_cost_mxn: 950, total_distance_km: 90, fitness: 1.0 }, 6) },
  });
  runs = applyCompareEvent(runs, {
    kind: "result",
    payload: { run_index: 2, ...entry("pyvrp", { total_cost_mxn: 950, feasible: false, fitness: 1.5 }, 6) },
  });
  return runs;
}

describe("flujo de eventos de /compare/stream", () => {
  it("parsea progress, result, complete y error con su discriminador", () => {
    const progress = parseCompareMessage({
      event: "progress",
      data: JSON.stringify({ run_index: 1, iteration: 3 }),
    });
    expect(progress?.kind).toBe("progress");
    expect(parseCompareMessage({ event: "complete", data: '{"entries":[]}' })?.kind).toBe("complete");
    expect(parseCompareMessage({ event: "error", data: '{"code":"busy","message":"x"}' })?.kind).toBe(
      "error",
    );
    expect(parseCompareMessage({ event: "ping", data: "{}" })).toBeNull();
  });

  it("acumula el historial de la corrida indicada y la marca en curso", () => {
    let runs = initialRuns(["ga", "aco"]);
    runs = startRun(runs, 0);
    runs = applyCompareEvent(runs, {
      kind: "progress",
      payload: {
        run_index: 0,
        iteration: 10,
        elapsed_s: 1.5,
        best_fitness: 2.5,
        metrics: metrics({ fitness: 2.5 }),
        stage: "evolving",
        extra: {},
      },
    });
    expect(runs[0].status).toBe("running");
    expect(runs[0].history).toEqual([{ iteration: 10, elapsed_s: 1.5, best_fitness: 2.5 }]);
    expect(runs[0].progress?.stage).toBe("evolving");
    expect(runs[1].status).toBe("pending");
  });

  it("complete rellena los gaps del servidor", () => {
    const runs = applyComplete(finishedRuns(), {
      entries: [
        entry("ga", { fitness: 1.1 }, 8, 10),
        entry("aco", { fitness: 1.0 }, 6, 0),
        entry("pyvrp", { fitness: 1.5 }, 6, 50),
      ],
      best_known: null,
    });
    expect(buildRows(runs).map((row) => row.gap)).toEqual([10, 0, 50]);
  });
});

describe("tabla de comparación", () => {
  it("calcula el gap contra la mejor corrida cuando el servidor aún no lo manda", () => {
    const rows = buildRows(finishedRuns());
    expect(rows[1].gap).toBe(0);
    expect(rows[0].gap).toBeCloseTo(10, 6);
    expect(rows[2].gap).toBeCloseTo(50, 6);
  });

  it("marca la mejor celda por columna y respeta los empates", () => {
    const best = bestCells(buildRows(finishedRuns()));
    expect([...best.cost]).toEqual([0]);
    expect([...best.vehicles].sort()).toEqual([1, 2]);
    expect([...best.distance]).toEqual([1]);
    expect([...best.runtime].sort()).toEqual([1, 2]);
    expect([...best.gap]).toEqual([1]);
  });

  it("no marca mejores mientras haya menos de dos corridas terminadas", () => {
    const runs = initialRuns(["ga", "aco"]);
    const best = bestCells(buildRows(runs));
    expect(best.cost.size).toBe(0);
  });

  it("ordena numérica y alfabéticamente y deja las pendientes al final", () => {
    const runs = initialRuns(["ga", "aco", "pyvrp", "ortools"]);
    const withResults = applyCompareEvent(
      applyCompareEvent(runs, {
        kind: "result",
        payload: { run_index: 0, ...entry("ga", { total_cost_mxn: 900 }) },
      }),
      { kind: "result", payload: { run_index: 1, ...entry("aco", { total_cost_mxn: 700 }) } },
    );
    const rows = buildRows(withResults);
    expect(sortRows(rows, "cost", "asc").map((row) => row.algorithm)).toEqual([
      "aco",
      "ga",
      "pyvrp",
      "ortools",
    ]);
    expect(sortRows(rows, "cost", "desc").map((row) => row.algorithm)).toEqual([
      "ga",
      "aco",
      "pyvrp",
      "ortools",
    ]);
    expect(sortRows(rows, "algorithm", "asc").map((row) => row.algorithm)).toEqual([
      "aco",
      "ga",
      "ortools",
      "pyvrp",
    ]);
  });

  it("alterna la dirección al repetir la columna", () => {
    const first = nextDirection(null, "cost");
    expect(first).toEqual({ key: "cost", direction: "asc" });
    expect(nextDirection(first, "cost").direction).toBe("desc");
    expect(nextDirection(first, "gap")).toEqual({ key: "gap", direction: "asc" });
  });
});
