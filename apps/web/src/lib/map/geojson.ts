import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import type { Driver, Location, Problem, Solution } from "@/lib/api/types";
import { routeColor, routeIsDashed } from "@/lib/routes/palette";

export type Emphasis = "selected" | "normal" | "dim";

export type MapFocus = {
  selectedRoute: number | null;
  hoveredRoute: number | null;
  selectedStopId: string | null;
};

export type MapExtras = {
  origins?: Record<string, Location>;
  delivered?: ReadonlySet<string>;
  flagUnassigned?: boolean;
};

export const EMPTY_FOCUS: MapFocus = {
  selectedRoute: null,
  hoveredRoute: null,
  selectedStopId: null,
};

export type RouteProps = {
  driverIndex: number;
  color: string;
  dashed: boolean;
  emphasis: Emphasis;
};

export type StopProps = {
  id: string;
  label: string;
  color: string;
  driverIndex: number;
  high: boolean;
  emphasis: Emphasis;
  selected: boolean;
  infeasible: boolean;
  delivered: boolean;
};

export function emphasisFor(driverIndex: number, focus: MapFocus): Emphasis {
  const active = focus.hoveredRoute ?? focus.selectedRoute;
  if (active === null) return "normal";
  return active === driverIndex ? "selected" : "dim";
}

export function driverIndexById(problem: Problem): Map<string, number> {
  return new Map(problem.drivers.map((driver, index) => [driver.id, index]));
}

export function originOf(problem: Problem, driver: Driver): Location | null {
  if (problem.mode === "multi_origin") return driver.start ?? problem.depot ?? null;
  return problem.depot ?? null;
}

export function terminalOf(problem: Problem, driver: Driver): Location | null {
  if (problem.mode === "multi_origin") return driver.end ?? null;
  return problem.depot ?? null;
}

function lngLat(location: Location): [number, number] {
  return [location.lon, location.lat];
}

export function buildRouteCollection(
  problem: Problem,
  solution: Solution | null,
  focus: MapFocus,
  extras?: MapExtras,
): FeatureCollection<LineString, RouteProps> {
  const features: Feature<LineString, RouteProps>[] = [];
  if (solution) {
    const indexById = driverIndexById(problem);
    const stopsById = new Map(problem.stops.map((stop) => [stop.id, stop]));
    for (const route of solution.routes) {
      const driverIndex = indexById.get(route.driver_id);
      if (driverIndex === undefined) continue;
      const driver = problem.drivers[driverIndex];
      let coordinates: [number, number][];
      if (route.geometry && route.geometry.length > 1) {
        coordinates = route.geometry.map(([lon, lat]) => [lon, lat]);
      } else {
        coordinates = [];
        const origin = extras?.origins?.[driver.id] ?? originOf(problem, driver);
        if (origin) coordinates.push(lngLat(origin));
        for (const visit of route.visits) {
          const stop = stopsById.get(visit.stop_id);
          if (stop) coordinates.push(lngLat(stop.location));
        }
        const terminal = terminalOf(problem, driver);
        if (terminal) coordinates.push(lngLat(terminal));
      }
      if (coordinates.length < 2) continue;
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates },
        properties: {
          driverIndex,
          color: routeColor(driverIndex),
          dashed: routeIsDashed(driverIndex),
          emphasis: emphasisFor(driverIndex, focus),
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

export type StopCollections = {
  assigned: FeatureCollection<Point, StopProps>;
  loose: FeatureCollection<Point, StopProps>;
};

export function buildStopCollections(
  problem: Problem,
  solution: Solution | null,
  focus: MapFocus,
  extras?: MapExtras,
): StopCollections {
  const assigned: Feature<Point, StopProps>[] = [];
  const loose: Feature<Point, StopProps>[] = [];
  const stopsById = new Map(problem.stops.map((stop) => [stop.id, stop]));
  const placed = new Set<string>();
  const indexById = driverIndexById(problem);

  if (solution) {
    for (const route of solution.routes) {
      const driverIndex = indexById.get(route.driver_id);
      if (driverIndex === undefined) continue;
      route.visits.forEach((visit, order) => {
        const stop = stopsById.get(visit.stop_id);
        if (!stop) return;
        placed.add(stop.id);
        assigned.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: lngLat(stop.location) },
          properties: {
            id: stop.id,
            label: String(order + 1),
            color: routeColor(driverIndex),
            driverIndex,
            high: stop.priority === "high",
            emphasis: emphasisFor(driverIndex, focus),
            selected: focus.selectedStopId === stop.id,
            infeasible: false,
            delivered: false,
          },
        });
      });
    }
  }

  const infeasible = solution !== null && (extras?.flagUnassigned ?? true);
  for (const stop of problem.stops) {
    if (placed.has(stop.id)) continue;
    loose.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: lngLat(stop.location) },
      properties: {
        id: stop.id,
        label: "",
        color: routeColor(0),
        driverIndex: -1,
        high: stop.priority === "high",
        emphasis: "normal",
        selected: focus.selectedStopId === stop.id,
        infeasible: infeasible && !extras?.delivered?.has(stop.id),
        delivered: extras?.delivered?.has(stop.id) ?? false,
      },
    });
  }
  return {
    assigned: { type: "FeatureCollection", features: assigned },
    loose: { type: "FeatureCollection", features: loose },
  };
}

export type Bounds = [[number, number], [number, number]];

export function computeBounds(problem: Problem): Bounds | null {
  const points: Location[] = problem.stops.map((stop) => stop.location);
  if (problem.depot) points.push(problem.depot);
  if (problem.mode === "multi_origin") {
    for (const driver of problem.drivers) {
      if (driver.start) points.push(driver.start);
      if (driver.end) points.push(driver.end);
    }
  }
  if (points.length === 0) return null;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const point of points) {
    minLon = Math.min(minLon, point.lon);
    maxLon = Math.max(maxLon, point.lon);
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
  }
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}

export type StopDetail = {
  stopId: string;
  address: string | null;
  priority: string;
  twStart: number | null;
  twEnd: number | null;
  demandKg: number;
  driverIndex: number | null;
  driverName: string | null;
  visitOrder: number | null;
  arrival: number | null;
  late: number | null;
};

export function describeStop(
  problem: Problem,
  solution: Solution | null,
  stopId: string,
): StopDetail | null {
  const stop = problem.stops.find((s) => s.id === stopId);
  if (!stop) return null;
  const detail: StopDetail = {
    stopId,
    address: stop.location.address ?? null,
    priority: stop.priority,
    twStart: stop.tw_start_min ?? null,
    twEnd: stop.tw_end_min ?? null,
    demandKg: stop.demand_kg,
    driverIndex: null,
    driverName: null,
    visitOrder: null,
    arrival: null,
    late: null,
  };
  if (solution) {
    for (const route of solution.routes) {
      const order = route.visits.findIndex((v) => v.stop_id === stopId);
      if (order === -1) continue;
      const driverIndex = problem.drivers.findIndex((d) => d.id === route.driver_id);
      detail.driverIndex = driverIndex === -1 ? null : driverIndex;
      detail.driverName =
        driverIndex === -1 ? route.driver_id : (problem.drivers[driverIndex].name ?? route.driver_id);
      detail.visitOrder = order + 1;
      detail.arrival = route.visits[order].arrival_min;
      detail.late = route.visits[order].late_min;
    }
  }
  return detail;
}
