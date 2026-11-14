import { describe, expect, it } from "vitest";
import { buildConvergence, fitnessDomain, suggestsLogScale } from "./convergence";
import { emptyRun, type RunState } from "./table";

function run(index: number, algorithm: string, points: [number, number][]): RunState {
  return {
    ...emptyRun(index, algorithm),
    history: points.map(([elapsed_s, best_fitness], i) => ({
      iteration: i,
      elapsed_s,
      best_fitness,
    })),
  };
}

describe("buildConvergence", () => {
  it("fusiona las corridas en un eje de tiempo común y ordenado", () => {
    const { data, series } = buildConvergence([
      run(0, "ga", [
        [1, 10],
        [3, 8],
      ]),
      run(1, "aco", [
        [2, 9],
        [3, 7],
      ]),
    ]);
    expect(series.map((s) => s.key)).toEqual(["run0", "run1"]);
    expect(data.map((p) => p.t)).toEqual([1, 2, 3]);
    expect(data[2]).toEqual({ t: 3, run0: 8, run1: 7 });
    expect(data[0].run1).toBeUndefined();
  });

  it("omite las corridas sin historial", () => {
    const { series } = buildConvergence([run(0, "ga", []), run(1, "aco", [[1, 5]])]);
    expect(series).toHaveLength(1);
    expect(series[0].algorithm).toBe("aco");
  });

  it("sugiere escala log cuando el rango es muy amplio", () => {
    const wide = buildConvergence([
      run(0, "ga", [
        [1, 1000],
        [2, 10],
      ]),
    ]);
    const narrow = buildConvergence([
      run(0, "ga", [
        [1, 12],
        [2, 10],
      ]),
    ]);
    expect(fitnessDomain(wide)).toEqual({ min: 10, max: 1000 });
    expect(suggestsLogScale(wide)).toBe(true);
    expect(suggestsLogScale(narrow)).toBe(false);
  });
});
