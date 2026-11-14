import type { Page, WebSocketRoute } from "@playwright/test";
import depotProblem from "../src/test/fixtures/mty-centro-depot-40.problem.json";
import depotSolution from "../src/test/fixtures/mty-centro-depot-40.solution.json";

const TICK_MS = 120;
const TOTAL_TICKS = 36;
const CLOCK_STEP_MIN = 6;

type Point = { lat: number; lon: number };
type ClientMessage = { type: string; [key: string]: unknown };

export type SimMock = { received: ClientMessage[] };

const stopsById = new Map(depotProblem.stops.map((stop) => [stop.id, stop]));

function lerp(a: Point, b: Point, t: number): Point {
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}

function pathOf(visits: { stop_id: string }[]): Point[] {
  const depot = depotProblem.depot;
  return [
    { lat: depot.lat, lon: depot.lon },
    ...visits.map((visit) => {
      const stop = stopsById.get(visit.stop_id);
      return { lat: stop?.location.lat ?? depot.lat, lon: stop?.location.lon ?? depot.lon };
    }),
  ];
}

function positionsAt(tick: number) {
  const fraction = Math.min(1, tick / TOTAL_TICKS);
  const delivered: string[] = [];
  const positions = depotSolution.solution.routes.map((route) => {
    const visits = route.visits;
    const path = pathOf(visits);
    const exact = fraction * (path.length - 1);
    const lower = Math.floor(exact);
    const upper = Math.min(path.length - 1, lower + 1);
    const previousExact = (Math.max(0, tick - 1) / TOTAL_TICKS) * (path.length - 1);
    const previousLower = Math.floor(previousExact);
    if (tick > 0 && lower > previousLower) {
      for (let i = previousLower; i < lower; i += 1) delivered.push(visits[i].stop_id);
    }
    return {
      driver_id: route.driver_id,
      location: { ...lerp(path[lower], path[upper], exact - lower), address: null },
      next_stop_id: visits[Math.min(lower, visits.length - 1)]?.stop_id ?? null,
      completed: lower,
      remaining: Math.max(0, visits.length - lower),
    };
  });
  return { positions, delivered };
}

function planWith(extraStop: ClientMessage | null) {
  const { solution } = depotSolution;
  if (!extraStop) return solution;
  const stop = extraStop.stop as { id: string };
  const routes = solution.routes.map((route, index) =>
    index === 0
      ? {
          ...route,
          visits: [
            ...route.visits,
            {
              stop_id: stop.id,
              arrival_min: route.metrics.end_min + 5,
              start_service_min: route.metrics.end_min + 5,
              departure_min: route.metrics.end_min + 10,
              late_min: 0,
            },
          ],
        }
      : route,
  );
  return { ...solution, routes };
}

export async function mockSimulation(page: Page): Promise<SimMock> {
  const mock: SimMock = { received: [] };

  await page.routeWebSocket("**/simulate", (ws: WebSocketRoute) => {
    let tick = 0;
    let paused = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const send = (message: unknown) => ws.send(JSON.stringify(message));

    const begin = () => {
      send({
        type: "reoptimized",
        clock_min: 0,
        solution: planWith(null),
        runtime_s: 0.8,
        reason: "initial",
      });
      timer = setInterval(() => {
        if (paused) return;
        tick += 1;
        const clock = tick * CLOCK_STEP_MIN;
        const { positions, delivered } = positionsAt(tick);
        if (tick === 6) {
          send({
            type: "order",
            clock_min: clock,
            stop: { ...depotProblem.stops[0], id: "s900", release_min: clock },
          });
          send({
            type: "reoptimized",
            clock_min: clock,
            solution: planWith(null),
            runtime_s: 1.1,
            reason: "event",
          });
        }
        send({ type: "tick", clock_min: clock, positions, delivered_stop_ids: delivered });
        if (tick >= TOTAL_TICKS && timer) {
          clearInterval(timer);
          send({
            type: "done",
            clock_min: clock,
            metrics: { ...depotSolution.solution.metrics, makespan_min: clock },
          });
        }
      }, TICK_MS);
    };

    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as ClientMessage;
      mock.received.push(message);
      if (message.type === "start") begin();
      if (message.type === "pause") paused = true;
      if (message.type === "resume") paused = false;
      if (message.type === "add_order") {
        const stop = message.stop as { release_min: number };
        send({ type: "order", clock_min: stop.release_min, stop: message.stop });
        send({
          type: "reoptimized",
          clock_min: stop.release_min,
          solution: planWith(message),
          runtime_s: 0.9,
          reason: "event",
        });
      }
    });
    ws.onClose(() => {
      if (timer) clearInterval(timer);
    });
  });

  return mock;
}
