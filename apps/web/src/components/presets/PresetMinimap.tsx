import { SILHOUETTES, silhouetteFor } from "@/lib/presets";

export function PresetMinimap({
  scenarioId,
  color,
  className,
}: {
  scenarioId: string;
  color: string;
  className?: string;
}) {
  const silhouette = silhouetteFor(scenarioId);
  if (!silhouette) return null;
  const { width, height } = SILHOUETTES;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
      className={className}
    >
      {silhouette.stops.map(([x, y], index) => (
        <circle
          key={`${x}-${y}-${index}`}
          cx={x}
          cy={y}
          r={2.2}
          fill={color}
          className="dot-in"
          style={{ animationDelay: `${Math.min(index * 8, 600)}ms` }}
        />
      ))}
      {silhouette.origins.map(([x, y], index) => (
        <circle
          key={`o-${index}`}
          cx={x}
          cy={y}
          r={3.4}
          fill="none"
          stroke="var(--text)"
          strokeWidth={1.4}
        />
      ))}
      {silhouette.depot ? (
        <rect
          x={silhouette.depot[0] - 3.6}
          y={silhouette.depot[1] - 3.6}
          width={7.2}
          height={7.2}
          rx={1.4}
          fill="var(--text)"
        />
      ) : null}
    </svg>
  );
}
