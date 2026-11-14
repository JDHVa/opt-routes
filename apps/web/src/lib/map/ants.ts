import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import type { RouteProps } from "@/lib/map/geojson";

const MIN_LOOP_MS = 6000;
const MAX_LOOP_MS = 14000;
const MS_PER_KM = 250;
export const MAX_ANTS_PER_ROUTE = 3;
const KM_PER_ANT = 7;
const KM_PER_DEGREE = 111;

export type AntPath = {
  driverIndex: number;
  coordinates: [number, number][];
  cumulative: number[];
  length: number;
  count: number;
};

export type AntProps = { driverIndex: number };

function segmentKm(a: [number, number], b: [number, number]): number {
  const meanLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * Math.cos(meanLat) * KM_PER_DEGREE;
  const dy = (b[1] - a[1]) * KM_PER_DEGREE;
  return Math.hypot(dx, dy);
}

export function buildAntPaths(collection: FeatureCollection<LineString, RouteProps>): AntPath[] {
  const paths: AntPath[] = [];
  for (const feature of collection.features) {
    const coordinates = feature.geometry.coordinates as [number, number][];
    if (coordinates.length < 2) continue;
    const cumulative = [0];
    for (let i = 1; i < coordinates.length; i += 1) {
      cumulative.push(cumulative[i - 1] + segmentKm(coordinates[i - 1], coordinates[i]));
    }
    const length = cumulative[cumulative.length - 1];
    if (length <= 0) continue;
    paths.push({
      driverIndex: feature.properties.driverIndex,
      coordinates,
      cumulative,
      length,
      count: Math.max(1, Math.min(MAX_ANTS_PER_ROUTE, Math.round(length / KM_PER_ANT))),
    });
  }
  return paths;
}

export function positionAt(path: AntPath, fraction: number): [number, number] {
  const wrapped = ((fraction % 1) + 1) % 1;
  const target = wrapped * path.length;
  const { cumulative, coordinates } = path;
  let low = 1;
  let high = cumulative.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (cumulative[mid] < target) low = mid + 1;
    else high = mid;
  }
  const end = cumulative[low];
  const start = cumulative[low - 1];
  const span = end - start;
  const local = span <= 0 ? 0 : (target - start) / span;
  const a = coordinates[low - 1];
  const b = coordinates[low];
  return [a[0] + (b[0] - a[0]) * local, a[1] + (b[1] - a[1]) * local];
}

export function antFeatures(
  paths: AntPath[],
  elapsedMs: number,
): FeatureCollection<Point, AntProps> {
  const features: Feature<Point, AntProps>[] = [];
  paths.forEach((path, routeIndex) => {
    const phase = (routeIndex * 0.37) % 1;
    for (let k = 0; k < path.count; k += 1) {
      const loopMs = Math.min(MAX_LOOP_MS, Math.max(MIN_LOOP_MS, path.length * MS_PER_KM));
      const fraction = elapsedMs / loopMs + phase + k / path.count;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: positionAt(path, fraction) },
        properties: { driverIndex: path.driverIndex },
      });
    }
  });
  return { type: "FeatureCollection", features };
}
