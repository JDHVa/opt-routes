"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { Switch } from "@/components/ui/switch";
import type { Locale } from "@/i18n/routing";
import { buildConvergence, suggestsLogScale } from "@/lib/compare/convergence";
import type { RunState } from "@/lib/compare/table";
import { formatNumber, formatSeconds } from "@/lib/format";
import { algorithmDisplayName } from "@/lib/planner/algorithms";
import { algorithmSeriesStyle } from "@/lib/routes/palette";

const AXIS_TICK = {
  fill: "var(--text-muted)",
  fontSize: 12,
  fontFamily: "var(--font-mono)",
};

export function ConvergenceChart({ runs }: { runs: RunState[] }) {
  const t = useTranslations("compare.chart");
  const locale = useLocale() as Locale;
  const [logScale, setLogScale] = useState(false);
  const convergence = useMemo(() => buildConvergence(runs), [runs]);
  const logSuggested = suggestsLogScale(convergence);
  const positions = useMemo(() => new Map(runs.map((run, i) => [run.index, i])), [runs]);

  const renderTooltip = (props: TooltipContentProps) => {
    if (!props.active || !props.payload?.length) return null;
    const point = props.payload[0].payload as Record<string, number | undefined>;
    const rows = convergence.series.flatMap((series) => {
      const value = point[series.key];
      if (value === undefined) return [];
      return [
        {
          label: algorithmDisplayName(series.algorithm),
          value: formatNumber(value, locale, 4),
          swatch: algorithmSeriesStyle(series.algorithm, positions.get(series.index) ?? 0),
        },
      ];
    });
    return <ChartTooltip title={formatSeconds(Number(point.t), locale)} rows={rows} />;
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby="convergence-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="convergence-title" className="text-h2 font-semibold">
          {t("title")}
        </h2>
        <label className="flex items-center gap-2 text-small">
          <Switch checked={logScale} onCheckedChange={setLogScale} />
          {t("logScale")}
          {logSuggested && !logScale ? (
            <span className="text-micro text-muted">{t("logHint")}</span>
          ) : null}
        </label>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-small">
        {convergence.series.map((series) => {
          const style = algorithmSeriesStyle(series.algorithm, positions.get(series.index) ?? 0);
          return (
            <li key={series.key} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-0.5 w-5"
                style={
                  style.dashed
                    ? {
                        backgroundImage: `repeating-linear-gradient(90deg, ${style.color} 0 4px, transparent 4px 6px)`,
                      }
                    : { backgroundColor: style.color }
                }
              />
              {algorithmDisplayName(series.algorithm)}
            </li>
          );
        })}
      </ul>
      <div
        role="img"
        aria-label={t("aria")}
        className="h-72 w-full rounded-lg border border-border bg-surface p-3"
      >
        {convergence.data.length === 0 ? (
          <p className="flex h-full items-center justify-center text-small text-muted">
            {t("empty")}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={convergence.data} margin={{ top: 8, right: 16, bottom: 20, left: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
              <XAxis
                type="number"
                dataKey="t"
                domain={[0, "dataMax"]}
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={{ stroke: "var(--border-strong)" }}
                tickFormatter={(value: number) => formatNumber(value, locale, 0)}
                label={{
                  value: t("xAxis"),
                  position: "insideBottom",
                  offset: -12,
                  fill: "var(--text-muted)",
                  fontSize: 12,
                }}
              />
              <YAxis
                scale={logScale ? "log" : "linear"}
                domain={logScale ? ["auto", "auto"] : ["dataMin", "dataMax"]}
                allowDataOverflow
                width={72}
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value: number) => formatNumber(value, locale, value < 10 ? 2 : 0)}
                label={{
                  value: t("yAxis"),
                  angle: -90,
                  position: "insideLeft",
                  fill: "var(--text-muted)",
                  fontSize: 12,
                }}
              />
              <Tooltip content={renderTooltip} cursor={{ stroke: "var(--border-strong)" }} isAnimationActive={false} />
              {convergence.series.map((series) => {
                const style = algorithmSeriesStyle(
                  series.algorithm,
                  positions.get(series.index) ?? 0,
                );
                return (
                  <Line
                    key={series.key}
                    type="stepAfter"
                    dataKey={series.key}
                    stroke={style.color}
                    strokeWidth={2}
                    strokeDasharray={style.dashed ? "6 4" : undefined}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
