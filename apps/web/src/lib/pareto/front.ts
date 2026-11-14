import type { ParetoPoint } from "@/lib/api/types";

export const OBJECTIVE_KEYS = ["time", "cost", "vehicles", "makespan"] as const;
export type ObjectiveKey = (typeof OBJECTIVE_KEYS)[number];

export type FrontPoint = {
  id: string;
  x: number;
  y: number;
  vehicles: number;
  dominated: boolean;
  source: ParetoPoint;
};

export type FrontRow = FrontPoint & { front: number | null };

export function pointId(point: ParetoPoint): string {
  return OBJECTIVE_KEYS.map((key) => (point.objectives[key] ?? 0).toFixed(4)).join("|");
}

function value(point: ParetoPoint, key: ObjectiveKey): number {
  return point.objectives[key] ?? 0;
}

function dominates(a: FrontPoint, b: FrontPoint): boolean {
  return a.x <= b.x && a.y <= b.y && (a.x < b.x || a.y < b.y);
}

export function toFrontPoints(
  points: ParetoPoint[],
  xKey: ObjectiveKey,
  yKey: ObjectiveKey,
): FrontPoint[] {
  const base = points.map((point) => ({
    id: pointId(point),
    x: value(point, xKey),
    y: value(point, yKey),
    vehicles: value(point, "vehicles"),
    dominated: false,
    source: point,
  }));
  return base.map((candidate) => ({
    ...candidate,
    dominated: base.some((other) => other !== candidate && dominates(other, candidate)),
  }));
}

export function toFrontRows(points: FrontPoint[]): FrontRow[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  let lowest = Infinity;
  return sorted.map((point) => {
    if (point.dominated) return { ...point, front: null };
    lowest = Math.min(lowest, point.y);
    return { ...point, front: lowest };
  });
}

export function sizeScale(
  vehicles: number,
  range: { min: number; max: number },
  smallest: number,
  largest: number,
): number {
  if (range.max <= range.min) return (smallest + largest) / 2;
  const fraction = (vehicles - range.min) / (range.max - range.min);
  return smallest + fraction * (largest - smallest);
}

export function vehicleRange(points: FrontPoint[]): { min: number; max: number } {
  if (points.length === 0) return { min: 0, max: 0 };
  const counts = points.map((point) => point.vehicles);
  return { min: Math.min(...counts), max: Math.max(...counts) };
}
