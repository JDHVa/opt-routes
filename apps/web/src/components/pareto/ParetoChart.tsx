"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { useReducedMotion } from "@/lib/motion/use-reduced-motion";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
  type ScatterShapeProps,
  type TooltipContentProps,
} from "recharts";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import type { Locale } from "@/i18n/routing";
import {
  OBJECTIVE_KEYS,
  sizeScale,
  toFrontRows,
  vehicleRange,
  type FrontPoint,
  type FrontRow,
  type ObjectiveKey,
} from "@/lib/pareto/front";
import { formatAxisTick, formatObjective, OBJECTIVE_UNITS } from "@/lib/pareto/format";

const AXIS_TICK = {
  fill: "var(--text-muted)",
  fontSize: 12,
  fontFamily: "var(--font-mono)",
};

const MIN_RADIUS = 4;
const MAX_RADIUS = 10;

function axisLabel(
  t: (key: string) => string,
  key: ObjectiveKey,
): string {
  const unit = OBJECTIVE_UNITS[key];
  return unit ? `${t(`objectives.${key}`)} (${unit})` : t(`objectives.${key}`);
}

export function ParetoChart({
  points,
  xKey,
  yKey,
  selectedId,
  onSelect,
}: {
  points: FrontPoint[];
  xKey: ObjectiveKey;
  yKey: ObjectiveKey;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("pareto");
  const locale = useLocale() as Locale;
  const reduced = useReducedMotion();
  const rows = useMemo(() => toFrontRows(points), [points]);
  const range = useMemo(() => vehicleRange(points), [points]);

  const renderPoint = (props: ScatterShapeProps) => {
    const payload = props.payload as FrontRow | undefined;
    if (!payload || props.cx === undefined || props.cy === undefined) return <g />;
    const radius = sizeScale(payload.vehicles, range, MIN_RADIUS, MAX_RADIUS);
    const selected = payload.id === selectedId;
    const order = (props as { index?: number }).index ?? 0;
    return (
      <g
        data-testid="pareto-point"
        onClick={() => onSelect(payload.id)}
        className="point-in"
        style={{ cursor: "pointer", animationDelay: `${Math.min(order * 45, 700)}ms` }}
      >
        {selected ? (
          <circle
            cx={props.cx}
            cy={props.cy}
            r={radius + 4}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
          />
        ) : null}
        <circle
          cx={props.cx}
          cy={props.cy}
          r={radius}
          fill={payload.dominated ? "var(--text-muted)" : "var(--accent)"}
          fillOpacity={payload.dominated ? 0.35 : 1}
          stroke="var(--surface)"
          strokeWidth={1.5}
        />
      </g>
    );
  };

  const renderTooltip = (props: TooltipContentProps) => {
    if (!props.active || !props.payload?.length) return null;
    const row = props.payload[0].payload as FrontRow | undefined;
    if (!row) return null;
    return (
      <ChartTooltip
        title={row.dominated ? t("dominated") : t("nonDominated")}
        rows={OBJECTIVE_KEYS.map((key) => ({
          label: t(`objectives.${key}`),
          value: formatObjective(key, row.source.objectives[key] ?? 0, locale),
        }))}
      />
    );
  };

  return (
    <div
      role="img"
      aria-label={t("chart.aria")}
      className="h-80 w-full rounded-lg border border-border bg-surface p-3"
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart accessibilityLayer={false} data={rows} margin={{ top: 12, right: 16, bottom: 24, left: 8 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
          <XAxis
            type="number"
            dataKey="x"
            name={t(`objectives.${xKey}`)}
            domain={["auto", "auto"]}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: "var(--border-strong)" }}
            tickFormatter={(value: number) => formatAxisTick(value, locale)}
            label={{
              value: axisLabel(t, xKey),
              position: "insideBottom",
              offset: -14,
              fill: "var(--text-muted)",
              fontSize: 12,
            }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={t(`objectives.${yKey}`)}
            domain={["auto", "auto"]}
            width={72}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => formatAxisTick(value, locale)}
            label={{
              value: axisLabel(t, yKey),
              angle: -90,
              position: "insideLeft",
              fill: "var(--text-muted)",
              fontSize: 12,
            }}
          />
          <Tooltip content={renderTooltip} cursor={false} isAnimationActive={false} />
          <Line
            dataKey="front"
            type="stepAfter"
            stroke="var(--text-muted)"
            strokeWidth={1.5}
            dot={false}
            activeDot={false}
            connectNulls
            isAnimationActive={!reduced}
            animationDuration={300}
            legendType="none"
            tooltipType="none"
          />
          <Scatter dataKey="y" shape={renderPoint} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
