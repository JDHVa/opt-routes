import type { Page, Route } from "@playwright/test";
import baseAlgorithms from "../src/test/data/algorithms.json";
import depotProblem from "../src/test/fixtures/mty-centro-depot-40.problem.json";
import depotSolution from "../src/test/fixtures/mty-centro-depot-40.solution.json";

export const SCENARIO_ID = "mty-centro-depot-40";
export const DYNAMIC_SCENARIO_ID = "mty-dynamic-100";

const acoEntry = baseAlgorithms.find((entry) => entry.name === "aco");
const algorithms = [
  ...baseAlgorithms,
  ...(acoEntry ? [{ ...acoEntry, name: "aco_ga", label: "ACO + GA (hybrid)" }] : []),
];

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
  {
    id: DYNAMIC_SCENARIO_ID,
    name: "Pedidos dinámicos, 100 paradas",
    description: "Pedidos que llegan durante el día",
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

export type SolverMock = {
  solveRequests: unknown[];
  compareRequests: unknown[];
  generateRequests: unknown[];
  importRequests: unknown[];
  exportRequests: unknown[];
};

const PARETO_SHAPES = [
  { time: 300, cost: 1900, vehicles: 2 },
  { time: 330, cost: 1700, vehicles: 2 },
  { time: 360, cost: 1520, vehicles: 3 },
  { time: 410, cost: 1400, vehicles: 3 },
  { time: 470, cost: 1330, vehicles: 4 },
  { time: 400, cost: 1800, vehicles: 3 },
  { time: 520, cost: 1500, vehicles: 4 },
];

function paretoPoints() {
  const { solution } = depotSolution;
  return PARETO_SHAPES.map((shape) => ({
    objectives: {
      time: shape.time,
      cost: shape.cost,
      vehicles: shape.vehicles,
      makespan: shape.time / shape.vehicles,
    },
    solution: {
      ...solution,
      algorithm: "nsga2",
      metrics: {
        ...solution.metrics,
        total_duration_min: shape.time,
        total_cost_mxn: shape.cost,
        vehicles_used: shape.vehicles,
        makespan_min: shape.time / shape.vehicles,
      },
    },
  }));
}

type CompareRunBody = { algorithm: string };

function compareEvents(runs: CompareRunBody[]) {
  const { solution } = depotSolution;
  const events: { event: string; data: unknown }[] = [];
  const entries = runs.map((run, index) => {
    const fitness = 0.7 + index * 0.08;
    const history = [
      { iteration: 1, elapsed_s: 0.4, best_fitness: fitness * 1.6 },
      { iteration: 5, elapsed_s: 1.2, best_fitness: fitness * 1.2 },
      { iteration: 9, elapsed_s: 2.4, best_fitness: fitness },
    ];
    const entrySolution = {
      ...solution,
      algorithm: run.algorithm,
      runtime_s: 2.4 + index * 0.3,
      metrics: {
        ...solution.metrics,
        fitness,
        total_cost_mxn: solution.metrics.total_cost_mxn + index * 60,
        total_distance_km: solution.metrics.total_distance_km + index * 2,
        vehicles_used: solution.metrics.vehicles_used + (index % 2),
        feasible: index !== 2,
      },
    };
    return { run: { algorithm: run.algorithm, params: {} }, solution: entrySolution, history, gap_pct: null as number | null };
  });
  const best = Math.min(...entries.map((entry) => entry.solution.metrics.fitness));
  entries.forEach((entry, index) => {
    entry.gap_pct = ((entry.solution.metrics.fitness - best) / best) * 100;
    for (const point of entry.history) {
      events.push({
        event: "progress",
        data: {
          run_index: index,
          iteration: point.iteration,
          elapsed_s: point.elapsed_s,
          best_fitness: point.best_fitness,
          stage: "evolving",
          metrics: entry.solution.metrics,
          solution: entry.solution,
          extra: {},
        },
      });
    }
    events.push({ event: "result", data: { run_index: index, ...entry } });
  });
  events.push({ event: "complete", data: { entries, best_known: null } });
  return events;
}

export async function mockSolver(
  page: Page,
  options: { failSolve?: boolean } = {},
): Promise<SolverMock> {
  const state: SolverMock = {
    solveRequests: [],
    compareRequests: [],
    generateRequests: [],
    importRequests: [],
    exportRequests: [],
  };
  const { solution, history } = depotSolution;

  await page.route("**/api/solver/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/solver/", "");

    if (path === "algorithms") return json(route, algorithms);
    if (path === "vehicles") return json(route, { vehicles });
    if (path === "scenarios") return json(route, scenarios);
    if (path === `scenarios/${SCENARIO_ID}` || path === `scenarios/${DYNAMIC_SCENARIO_ID}`) {
      return json(route, depotProblem);
    }

    if (path === "scenarios/generate" && request.method() === "POST") {
      state.generateRequests.push(request.postDataJSON());
      return json(route, { ...depotProblem, name: "generated" });
    }

    if (path === "import/csv" && request.method() === "POST") {
      const body = request.postDataJSON() as { text: string };
      state.importRequests.push(body);
      if (body.text.includes("bad")) {
        return json(
          route,
          {
            code: "invalid_csv",
            message: "2 rows invalid",
            rows: [
              { row: 3, message: "lat fuera de rango" },
              { row: 7, message: "falta la columna lon" },
            ],
          },
          422,
        );
      }
      return json(route, { stops: depotProblem.stops.slice(0, 5) });
    }

    if (path === "export/csv" && request.method() === "POST") {
      state.exportRequests.push(request.postDataJSON());
      return route.fulfill({
        status: 200,
        contentType: "text/csv",
        body: "driver,order,stop\nd01,1,s001\n",
      });
    }

    if (path === "compare/stream" && request.method() === "POST") {
      const body = request.postDataJSON() as { runs: CompareRunBody[] };
      state.compareRequests.push(body);
      return route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        body: sse(compareEvents(body.runs)),
      });
    }

    if (path === "solve/stream" && request.method() === "POST") {
      state.solveRequests.push(request.postDataJSON());
      if (options.failSolve) {
        return json(route, { code: "solver_unreachable", message: "connect ECONNREFUSED" }, 502);
      }
      const requested = state.solveRequests[state.solveRequests.length - 1] as {
        run: { algorithm: string };
      };
      const algorithm = requested.run.algorithm;
      const hybrid = algorithm === "aco_ga";
      const shaped = { ...solution, algorithm };
      const progress = history.map((point, index) => ({
        event: "progress",
        data: {
          stage: hybrid ? "cooperating" : "evolving",
          iteration: point.iteration,
          elapsed_s: point.elapsed_s,
          best_fitness: point.best_fitness,
          metrics: solution.metrics,
          solution: {
            ...shaped,
            routes: solution.routes.slice(0, Math.min(index + 1, solution.routes.length)),
          },
          pareto: null,
          extra: hybrid ? { improvements_from_ga: 7, improvements_from_aco: 3 } : {},
        },
      }));
      const pareto = algorithm === "nsga2" ? paretoPoints() : null;
      const body = sse([
        ...progress,
        { event: "result", data: { solution: shaped, history, pareto } },
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
