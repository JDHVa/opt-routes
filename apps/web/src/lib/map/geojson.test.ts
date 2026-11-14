import { describe, expect, it } from "vitest";
import multiProblem from "@/test/fixtures/mty-multiorigin-80.problem.json";
import multiSolution from "@/test/fixtures/mty-multiorigin-80.solution.json";
import depotProblem from "@/test/fixtures/mty-centro-depot-40.problem.json";
import depotSolution from "@/test/fixtures/mty-centro-depot-40.solution.json";
import type { Problem, Solution } from "@/lib/api/types";
import { routeColor } from "@/lib/routes/palette";
import {
  buildRouteCollection,
  buildStopCollections,
  computeBounds,
  describeStop,
  EMPTY_FOCUS,
} from "./geojson";

const depot = depotProblem as unknown as Problem;
const depotSol = (depotSolution as unknown as { solution: Solution }).solution;
const multi = multiProblem as unknown as Problem;
const multiSol = (multiSolution as unknown as { solution: Solution }).solution;

describe("buildRouteCollection", () => {
  it("dibuja una línea por ruta: depósito, paradas, depósito", () => {
    const routes = buildRouteCollection(depot, depotSol, EMPTY_FOCUS);
    expect(routes.features).toHaveLength(depotSol.routes.length);
    const first = routes.features[0].geometry.coordinates;
    expect(first).toHaveLength(depotSol.routes[0].visits.length + 2);
    expect(first[0]).toEqual([depot.depot!.lon, depot.depot!.lat]);
    expect(first[first.length - 1]).toEqual(first[0]);
  });

  it("en multi-origen parte del inicio del repartidor y la ruta queda abierta", () => {
    const routes = buildRouteCollection(multi, multiSol, EMPTY_FOCUS);
    const feature = routes.features[0];
    const driver = multi.drivers[feature.properties.driverIndex];
    expect(feature.geometry.coordinates[0]).toEqual([driver.start!.lon, driver.start!.lat]);
    const route = multiSol.routes[0];
    expect(feature.geometry.coordinates).toHaveLength(route.visits.length + 1);
  });

  it("usa Route.geometry (lat, lon) y la convierte a (lon, lat)", () => {
    const geometry: [number, number][] = [
      [25.6, -100.3],
      [25.7, -100.2],
    ];
    const withGeometry: Solution = {
      ...depotSol,
      routes: depotSol.routes.map((r) => ({ ...r, geometry })),
    };
    const routes = buildRouteCollection(depot, withGeometry, EMPTY_FOCUS);
    expect(routes.features[0].geometry.coordinates).toEqual([
      [-100.3, 25.6],
      [-100.2, 25.7],
    ]);
  });

  it("el color depende del índice del repartidor, no del orden de las rutas", () => {
    const reversed: Solution = { ...depotSol, routes: [...depotSol.routes].reverse() };
    const routes = buildRouteCollection(depot, reversed, EMPTY_FOCUS);
    for (const feature of routes.features) {
      expect(feature.properties.color).toBe(routeColor(feature.properties.driverIndex));
    }
  });

  it("selección y hover atenúan las demás rutas", () => {
    const routes = buildRouteCollection(depot, depotSol, { ...EMPTY_FOCUS, selectedRoute: 0 });
    expect(routes.features.map((f) => f.properties.emphasis)).toEqual(["selected", "dim"]);
    const hovered = buildRouteCollection(depot, depotSol, {
      ...EMPTY_FOCUS,
      selectedRoute: 0,
      hoveredRoute: 1,
    });
    expect(hovered.features.map((f) => f.properties.emphasis)).toEqual(["dim", "selected"]);
  });

  it("sin solución no hay rutas", () => {
    expect(buildRouteCollection(depot, null, EMPTY_FOCUS).features).toHaveLength(0);
  });
});

describe("buildStopCollections", () => {
  it("numera las visitas por ruta y marca prioridad alta", () => {
    const { assigned, loose } = buildStopCollections(multi, multiSol, EMPTY_FOCUS);
    expect(assigned.features).toHaveLength(multi.stops.length);
    expect(loose.features).toHaveLength(0);
    const first = multiSol.routes[0].visits[0].stop_id;
    expect(assigned.features.find((f) => f.properties.id === first)?.properties.label).toBe("1");
    const highs = multi.stops.filter((s) => s.priority === "high").length;
    expect(assigned.features.filter((f) => f.properties.high)).toHaveLength(highs);
  });

  it("las paradas sin asignar van aparte y marcan infactibilidad si hay solución", () => {
    const partial: Solution = {
      ...depotSol,
      routes: [{ ...depotSol.routes[0], visits: depotSol.routes[0].visits.slice(0, 5) }],
    };
    const { assigned, loose } = buildStopCollections(depot, partial, EMPTY_FOCUS);
    expect(assigned.features).toHaveLength(5);
    expect(loose.features).toHaveLength(depot.stops.length - 5);
    expect(loose.features.every((f) => f.properties.infeasible)).toBe(true);
  });

  it("antes de resolver todas las paradas están sueltas y sin alarma", () => {
    const { assigned, loose } = buildStopCollections(depot, null, EMPTY_FOCUS);
    expect(assigned.features).toHaveLength(0);
    expect(loose.features).toHaveLength(depot.stops.length);
    expect(loose.features.every((f) => !f.properties.infeasible)).toBe(true);
  });
});

describe("computeBounds y describeStop", () => {
  it("el rectángulo contiene todas las paradas y el depósito", () => {
    const bounds = computeBounds(depot)!;
    for (const stop of depot.stops) {
      expect(stop.location.lon).toBeGreaterThanOrEqual(bounds[0][0]);
      expect(stop.location.lon).toBeLessThanOrEqual(bounds[1][0]);
      expect(stop.location.lat).toBeGreaterThanOrEqual(bounds[0][1]);
      expect(stop.location.lat).toBeLessThanOrEqual(bounds[1][1]);
    }
    expect(bounds[1][1]).toBeGreaterThanOrEqual(depot.depot!.lat);
  });

  it("describe una parada ruteada con su visita y ETA", () => {
    const route = depotSol.routes[0];
    const detail = describeStop(depot, depotSol, route.visits[2].stop_id)!;
    expect(detail.visitOrder).toBe(3);
    expect(detail.arrival).toBe(route.visits[2].arrival_min);
    expect(detail.driverIndex).toBe(depot.drivers.findIndex((d) => d.id === route.driver_id));
  });

  it("devuelve null para una parada inexistente", () => {
    expect(describeStop(depot, depotSol, "nope")).toBeNull();
  });
});
