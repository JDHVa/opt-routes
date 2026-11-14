import type { DriverPosition } from "@/lib/api/types";

export type LatLon = { lat: number; lon: number };

export type Positions = Record<string, LatLon>;

export type Tween = {
  from: Positions;
  to: Positions;
  startMs: number;
  durationMs: number;
};

export const DEFAULT_TICK_MS = 500;
export const MIN_TICK_MS = 100;
export const MAX_TICK_MS = 2000;

export function lerpLatLon(a: LatLon, b: LatLon, fraction: number): LatLon {
  const t = Math.min(1, Math.max(0, fraction));
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}

export function positionsOf(drivers: DriverPosition[]): Positions {
  const result: Positions = {};
  for (const driver of drivers) {
    result[driver.driver_id] = { lat: driver.location.lat, lon: driver.location.lon };
  }
  return result;
}

export function tickDuration(previousTickMs: number | null, nowMs: number): number {
  if (previousTickMs === null) return DEFAULT_TICK_MS;
  return Math.min(MAX_TICK_MS, Math.max(MIN_TICK_MS, nowMs - previousTickMs));
}

export function retarget(
  current: Positions,
  next: Positions,
  nowMs: number,
  durationMs: number,
): Tween {
  const from: Positions = {};
  for (const [id, target] of Object.entries(next)) from[id] = current[id] ?? target;
  return { from, to: next, startMs: nowMs, durationMs };
}

export function sampleTween(tween: Tween, nowMs: number): Positions {
  const fraction = tween.durationMs <= 0 ? 1 : (nowMs - tween.startMs) / tween.durationMs;
  const result: Positions = {};
  for (const [id, target] of Object.entries(tween.to)) {
    result[id] = lerpLatLon(tween.from[id] ?? target, target, fraction);
  }
  return result;
}

export function tweenFinished(tween: Tween, nowMs: number): boolean {
  return nowMs - tween.startMs >= tween.durationMs;
}
