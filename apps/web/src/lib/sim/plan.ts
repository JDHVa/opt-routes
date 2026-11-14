import type { DriverPosition, Location, Problem, Solution, Stop } from "@/lib/api/types";

export type PlanView = {
  problem: Problem;
  solution: Solution | null;
  origins: Record<string, Location>;
  delivered: ReadonlySet<string>;
};

export function buildPlanView(
  base: Problem,
  stops: Stop[],
  plan: Solution | null,
  positions: DriverPosition[],
  deliveredIds: string[],
): PlanView {
  const origins: Record<string, Location> = {};
  for (const position of positions) origins[position.driver_id] = position.location;
  return {
    problem: { ...base, stops },
    solution: plan,
    origins,
    delivered: new Set(deliveredIds),
  };
}

export function nextOrderId(existingIds: Iterable<string>): string {
  let highest = 0;
  for (const id of existingIds) {
    const match = /^u(\d+)$/.exec(id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `u${String(highest + 1).padStart(3, "0")}`;
}

export const NEW_ORDER_DEMAND_KG = 5;
export const NEW_ORDER_DEMAND_M3 = 0.02;
export const NEW_ORDER_SERVICE_MIN = 5;

export function makeOrder(
  id: string,
  point: { lat: number; lon: number },
  clockMin: number,
): Stop {
  return {
    id,
    location: { lat: point.lat, lon: point.lon, address: null },
    demand_kg: NEW_ORDER_DEMAND_KG,
    demand_m3: NEW_ORDER_DEMAND_M3,
    service_min: NEW_ORDER_SERVICE_MIN,
    tw_start_min: null,
    tw_end_min: null,
    priority: "normal",
    release_min: clockMin,
  };
}

export function markPosition(clock: number, horizon: number): number {
  if (horizon <= 0) return 0;
  return Math.min(100, Math.max(0, (clock / horizon) * 100));
}
