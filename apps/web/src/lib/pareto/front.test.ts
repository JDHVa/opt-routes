import { describe, expect, it } from "vitest";
import type { ParetoPoint, Solution } from "@/lib/api/types";
import {
  pointId,
  sizeScale,
  toFrontPoints,
  toFrontRows,
  vehicleRange,
} from "./front";

const SOLUTION = {
  algorithm: "nsga2",
  routes: [],
  unassigned_stop_ids: [],
  metrics: {},
  runtime_s: 1,
} as unknown as Solution;

function point(time: number, cost: number, vehicles: number, makespan = time / 2): ParetoPoint {
  return { objectives: { time, cost, vehicles, makespan }, solution: SOLUTION };
}

describe("frente de Pareto", () => {
  const points = [point(100, 900, 5), point(120, 700, 4), point(150, 650, 3), point(130, 800, 4)];

  it("marca como dominados los puntos peores en ambos ejes", () => {
    const front = toFrontPoints(points, "time", "cost");
    expect(front.map((p) => p.dominated)).toEqual([false, false, false, true]);
  });

  it("recalcula la dominancia al cambiar los ejes", () => {
    const byVehicles = toFrontPoints(points, "vehicles", "cost");
    expect(byVehicles.find((p) => p.x === 5)?.dominated).toBe(true);
    expect(byVehicles.find((p) => p.x === 3)?.dominated).toBe(false);
  });

  it("construye la línea escalonada solo con los no dominados, ordenada por x", () => {
    const rows = toFrontRows(toFrontPoints(points, "time", "cost"));
    expect(rows.map((r) => r.x)).toEqual([100, 120, 130, 150]);
    expect(rows.map((r) => r.front)).toEqual([900, 700, null, 650]);
  });

  it("los duplicados exactos no se dominan entre sí", () => {
    const front = toFrontPoints([point(100, 900, 5), point(100, 900, 5)], "time", "cost");
    expect(front.every((p) => !p.dominated)).toBe(true);
  });

  it("calcula el rango de vehículos y el tamaño del punto", () => {
    const front = toFrontPoints(points, "time", "cost");
    const range = vehicleRange(front);
    expect(range).toEqual({ min: 3, max: 5 });
    expect(sizeScale(3, range, 4, 10)).toBe(4);
    expect(sizeScale(5, range, 4, 10)).toBe(10);
    expect(sizeScale(4, { min: 4, max: 4 }, 4, 10)).toBe(7);
    expect(vehicleRange([])).toEqual({ min: 0, max: 0 });
  });

  it("el id es estable y distingue objetivos distintos", () => {
    expect(pointId(points[0])).toBe(pointId(point(100, 900, 5)));
    expect(pointId(points[0])).not.toBe(pointId(points[1]));
  });
});
