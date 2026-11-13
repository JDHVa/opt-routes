import type { Page, Route } from "@playwright/test";
import algorithms from "../src/test/data/algorithms.json";
import depotProblem from "../src/test/fixtures/mty-centro-depot-40.problem.json";
import depotSolution from "../src/test/fixtures/mty-centro-depot-40.solution.json";

export const SCENARIO_ID = "mty-centro-depot-40";

const vehicles = depotProblem.vehicle_types;

const scenarios = [
  {
    id: SCENARIO_ID,
    name: depotProblem.name,
    description: "Centro de Monterrey, depósito único",
    n_stops: depotProblem.stops.length,
    n_drivers: depotProblem.drivers.length,
    mode: depotProblem.mode,
    region: "mty",
  },
];

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function sse(events: { event: string; data: unknown }[]): string {
  return events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join("");
}

export type SolverMock = { solveRequests: unknown[] };

export async function mockSolver(
  page: Page,
  options: { failSolve?: boolean } = {},
): Promise<SolverMock> {
  const state: SolverMock = { solveRequests: [] };
  const { solution, history } = depotSolution;

  await page.route("**/api/solver/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/solver/", "");

    if (path === "algorithms") return json(route, algorithms);
    if (path === "vehicles") return json(route, { vehicles });
    if (path === "scenarios") return json(route, scenarios);
    if (path === `scenarios/${SCENARIO_ID}`) return json(route, depotProblem);

    if (path === "solve/stream" && request.method() === "POST") {
      state.solveRequests.push(request.postDataJSON());
      if (options.failSolve) {
        return json(route, { code: "solver_unreachable", message: "connect ECONNREFUSED" }, 502);
      }
      const progress = history.map((point, index) => ({
        event: "progress",
        data: {
          iteration: point.iteration,
          elapsed_s: point.elapsed_s,
          best_fitness: point.best_fitness,
          metrics: solution.metrics,
          solution: {
            ...solution,
            routes: solution.routes.slice(0, Math.min(index + 1, solution.routes.length)),
          },
          pareto: null,
          extra: {},
        },
      }));
      const body = sse([
        ...progress,
        { event: "result", data: { solution, history, pareto: null } },
      ]);
      return route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        body,
      });
    }

    return json(route, { code: "not_found", message: path }, 404);
  });

  return state;
}
