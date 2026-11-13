import { getTranslations } from "next-intl/server";
import { demoProblem, demoSolution } from "@/lib/landing-data";
import { routeColor } from "@/lib/routes/palette";

const CELL = 15;
const GAP = 3;
const LEFT = 16;

export async function SplitDiagram() {
  const t = await getTranslations("landing.diagrams.split");
  const segments = demoSolution.routes.map((route, index) => ({
    index,
    ids: route.visits.map((visit) => visit.stop_id),
  }));
  const ids = segments.flatMap((segment) => segment.ids);
  const step = CELL + GAP;
  const width = LEFT * 2 + ids.length * step;
  const starts = segments.map((_, i) =>
    segments.slice(0, i).reduce((sum, segment) => sum + segment.ids.length, 0),
  );

  return (
    <svg
      viewBox={`0 0 ${width} 150`}
      role="img"
      aria-label={t("aria")}
      className="h-auto w-full"
    >
      <text x={LEFT} y="14" className="fill-muted text-[11px]">
        {t("tour")}
      </text>
      {ids.map((id, i) => (
        <g key={id}>
          <rect
            x={LEFT + i * step}
            y="24"
            width={CELL}
            height={CELL}
            rx="3"
            className="fill-surface-2 stroke-border-strong"
          />
        </g>
      ))}
      {segments.map((segment) => {
        const x0 = LEFT + starts[segment.index] * step;
        const x1 = x0 + segment.ids.length * step - GAP;
        const color = routeColor(segment.index);
        return (
          <g key={segment.index}>
            {segment.index > 0 ? (
              <line
                x1={x0 - GAP / 2 - 0.5}
                x2={x0 - GAP / 2 - 0.5}
                y1="16"
                y2="108"
                strokeDasharray="3 3"
                className="stroke-muted"
              />
            ) : null}
            <rect x={x0} y="24" width={x1 - x0} height="3" rx="1.5" style={{ fill: color }} />
            <path
              d={`M ${x0} 52 v 6 h ${x1 - x0} v -6`}
              fill="none"
              strokeWidth="1.5"
              style={{ stroke: color }}
            />
            <text x={x0} y="76" className="fill-foreground text-[12px] font-medium">
              {t("segment", { n: segment.index + 1 })}
            </text>
            <text x={x0} y="92" className="fill-muted text-[11px]">
              {t("segmentStops", { count: segment.ids.length })}
            </text>
          </g>
        );
      })}
      <text x={LEFT} y="132" className="fill-muted text-[11px]">
        {t("vorder")}: {segments.map((s) => `d${String(s.index + 1).padStart(2, "0")}`).join(" → ")}
      </text>
    </svg>
  );
}

const PHEROMONE_NODES = 9;
const BOX_W = 360;
const BOX_H = 220;
const PAD = 28;

export async function PheromoneDiagram() {
  const t = await getTranslations("landing.diagrams.pheromone");
  const route = demoSolution.routes[0];
  const stopsById = new Map(demoProblem.stops.map((s) => [s.id, s]));
  const depot = demoProblem.depot;
  const sequence = route.visits.slice(0, PHEROMONE_NODES).map((visit) => {
    const stop = stopsById.get(visit.stop_id);
    return { id: visit.stop_id, lon: stop?.location.lon ?? 0, lat: stop?.location.lat ?? 0 };
  });
  const nodes = [
    { id: "depot", lon: depot?.lon ?? 0, lat: depot?.lat ?? 0 },
    ...sequence,
  ];
  const lons = nodes.map((n) => n.lon);
  const lats = nodes.map((n) => n.lat);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const project = (lon: number, lat: number): [number, number] => [
    PAD + ((lon - minLon) / (maxLon - minLon || 1)) * (BOX_W - 2 * PAD),
    PAD + (1 - (lat - minLat) / (maxLat - minLat || 1)) * (BOX_H - 2 * PAD),
  ];
  const points = nodes.map((n) => project(n.lon, n.lat));

  const distance = (a: number, b: number) =>
    Math.hypot(nodes[a].lon - nodes[b].lon, nodes[a].lat - nodes[b].lat);
  const neighbours = new Set<string>();
  nodes.forEach((_, i) => {
    nodes
      .map((__, j) => ({ j, d: i === j ? Infinity : distance(i, j) }))
      .sort((x, y) => x.d - y.d)
      .slice(0, 3)
      .forEach(({ j }) => neighbours.add(`${Math.min(i, j)}-${Math.max(i, j)}`));
  });
  const unique = Array.from(neighbours);
  const bestEdges: [number, number][] = nodes.slice(1).map((_, i) => [i, i + 1]);

  return (
    <svg
      viewBox={`0 0 ${BOX_W} ${BOX_H}`}
      role="img"
      aria-label={t("aria")}
      className="h-auto w-full"
    >
      {unique.map((key) => {
        const [a, b] = key.split("-").map(Number);
        return (
          <line
            key={key}
            x1={points[a][0]}
            y1={points[a][1]}
            x2={points[b][0]}
            y2={points[b][1]}
            strokeWidth="1"
            className="stroke-border-strong"
          />
        );
      })}
      {bestEdges.map(([a, b]) => (
        <line
          key={`best-${a}-${b}`}
          x1={points[a][0]}
          y1={points[a][1]}
          x2={points[b][0]}
          y2={points[b][1]}
          strokeWidth="4"
          strokeLinecap="round"
          className="stroke-accent"
        />
      ))}
      {points.map(([x, y], i) =>
        i === 0 ? (
          <rect
            key="depot"
            x={x - 6}
            y={y - 6}
            width="12"
            height="12"
            rx="2"
            className="fill-foreground"
          />
        ) : (
          <circle key={nodes[i].id} cx={x} cy={y} r="5" className="fill-surface stroke-accent" strokeWidth="2" />
        ),
      )}
      <text x="8" y={BOX_H - 8} className="fill-muted text-[11px]">
        {t("rule")}
      </text>
    </svg>
  );
}

const FRONT: [number, number][] = [
  [60, 40],
  [90, 74],
  [130, 100],
  [180, 118],
  [240, 128],
];
const DOMINATED: [number, number][] = [
  [100, 60],
  [120, 70],
  [150, 88],
  [170, 96],
  [210, 106],
  [200, 112],
  [262, 118],
  [150, 92],
];

export async function ParetoDiagram() {
  const t = await getTranslations("landing.diagrams.pareto");
  const frontLine = FRONT.flatMap(([x, y], i) =>
    i === 0 ? [`${x},${y}`] : [`${x},${FRONT[i - 1][1]}`, `${x},${y}`],
  ).join(" ");

  return (
    <svg viewBox="0 0 320 190" role="img" aria-label={t("aria")} className="h-auto w-full">
      <line x1="36" y1="156" x2="304" y2="156" className="stroke-border-strong" />
      <line x1="36" y1="16" x2="36" y2="156" className="stroke-border-strong" />
      <text x="304" y="176" textAnchor="end" className="fill-muted text-[11px]">
        {t("axisX")}
      </text>
      <text x="40" y="12" className="fill-muted text-[11px]">
        {t("axisY")}
      </text>
      <g transform="translate(24 6)">
        {DOMINATED.map(([x, y]) => (
          <circle key={`d-${x}-${y}`} cx={x} cy={y} r="4" className="fill-faint" opacity="0.5" />
        ))}
        <polyline fill="none" strokeWidth="1.5" className="stroke-accent" points={frontLine} />
        {FRONT.map(([x, y], i) => (
          <circle key={`f-${x}`} cx={x} cy={y} r={4 + i} className="fill-accent" />
        ))}
      </g>
    </svg>
  );
}
