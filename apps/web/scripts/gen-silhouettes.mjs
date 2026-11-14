import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const SCENARIOS_DIR = new URL(
  "../../../services/solver/src/routeopt/data/scenarios/",
  import.meta.url,
);
const OUTPUT = new URL("../src/data/silhouettes.json", import.meta.url);
const WIDTH = 160;
const HEIGHT = 96;
const MARGIN = 8;

function project(points) {
  const lons = points.map((p) => p.lon);
  const lats = points.map((p) => p.lat);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const meanLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const spanX = Math.max((maxLon - minLon) * Math.cos(meanLat), 1e-9);
  const spanY = Math.max(maxLat - minLat, 1e-9);
  const scale = Math.min((WIDTH - 2 * MARGIN) / spanX, (HEIGHT - 2 * MARGIN) / spanY);
  const offsetX = (WIDTH - spanX * scale) / 2;
  const offsetY = (HEIGHT - spanY * scale) / 2;
  return (point) => [
    Math.round((offsetX + (point.lon - minLon) * Math.cos(meanLat) * scale) * 10) / 10,
    Math.round((offsetY + (maxLat - point.lat) * scale) * 10) / 10,
  ];
}

const result = {};
for (const file of readdirSync(SCENARIOS_DIR).filter((name) => name.endsWith(".json")).sort()) {
  const scenario = JSON.parse(readFileSync(new URL(file, SCENARIOS_DIR), "utf8"));
  const problem = scenario.problem;
  const stops = problem.stops.map((stop) => stop.location);
  const origins = problem.mode === "multi_origin"
    ? problem.drivers.map((driver) => driver.start).filter(Boolean)
    : [];
  const depot = problem.depot ?? null;
  const all = [...stops, ...origins, ...(depot ? [depot] : [])];
  const toXY = project(all);
  result[scenario.id] = {
    stops: stops.map(toXY),
    depot: depot ? toXY(depot) : null,
    origins: origins.map(toXY),
  };
}

writeFileSync(OUTPUT, `${JSON.stringify({ width: WIDTH, height: HEIGHT, scenarios: result })}\n`);
console.log(`silhouettes: ${Object.keys(result).length} escenarios`);
