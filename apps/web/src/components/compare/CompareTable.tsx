"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, CircleCheck, TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import type { Locale } from "@/i18n/routing";
import {
  bestCells,
  buildRows,
  nextDirection,
  sortRows,
  type CompareRow,
  type MetricKey,
  type RunState,
  type SortDirection,
  type SortKey,
} from "@/lib/compare/table";
import {
  formatKm,
  formatMinutes,
  formatMXN,
  formatNumber,
  formatSeconds,
} from "@/lib/format";
import { algorithmDisplayName } from "@/lib/planner/algorithms";
import { algorithmSeriesStyle } from "@/lib/routes/palette";
import { cn } from "@/lib/utils";

type Column = { key: SortKey; numeric: boolean };

const COLUMNS: Column[] = [
  { key: "algorithm", numeric: false },
  { key: "cost", numeric: true },
  { key: "duration", numeric: true },
  { key: "makespan", numeric: true },
  { key: "vehicles", numeric: true },
  { key: "distance", numeric: true },
  { key: "gap", numeric: true },
  { key: "runtime", numeric: true },
  { key: "feasible", numeric: false },
];

function formatCell(key: MetricKey, value: number, locale: Locale): string {
  switch (key) {
    case "cost":
      return formatMXN(value, locale);
    case "duration":
    case "makespan":
      return formatMinutes(value, locale);
    case "vehicles":
      return formatNumber(value, locale);
    case "distance":
      return formatKm(value, locale);
    case "gap":
      return `${formatNumber(value, locale, 1)} %`;
    case "runtime":
      return formatSeconds(value, locale);
  }
}

function SortIcon({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) {
    return <ArrowUpDown size={16} strokeWidth={1.75} aria-hidden="true" className="text-faint" />;
  }
  return direction === "asc" ? (
    <ArrowUp size={16} strokeWidth={1.75} aria-hidden="true" />
  ) : (
    <ArrowDown size={16} strokeWidth={1.75} aria-hidden="true" />
  );
}

function AlgorithmCell({ row, position }: { row: CompareRow; position: number }) {
  const t = useTranslations("compare.table.status");
  const style = algorithmSeriesStyle(row.algorithm, position);
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className="h-1 w-5 shrink-0 rounded-full"
        style={
          style.dashed
            ? {
                backgroundImage: `repeating-linear-gradient(90deg, ${style.color} 0 6px, transparent 6px 9px)`,
              }
            : { backgroundColor: style.color }
        }
      />
      <span className="flex min-w-0 flex-col">
        <span className="font-medium">{algorithmDisplayName(row.algorithm)}</span>
        {row.status !== "done" ? (
          <span className="text-micro text-muted">{t(row.status)}</span>
        ) : null}
      </span>
    </div>
  );
}

export function CompareTable({ runs, running }: { runs: RunState[]; running: boolean }) {
  const t = useTranslations("compare.table");
  const locale = useLocale() as Locale;
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection } | null>(null);

  const rows = useMemo(() => buildRows(runs), [runs]);
  const best = useMemo(() => bestCells(rows), [rows]);
  const ordered = useMemo(
    () => (sort ? sortRows(rows, sort.key, sort.direction) : rows),
    [rows, sort],
  );

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full min-w-[56rem] text-sm" aria-busy={running}>
        <caption className="sr-only">{t("caption")}</caption>
        <thead>
          <tr className="border-b border-border">
            {COLUMNS.map((column) => {
              const active = sort?.key === column.key;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
                  }
                  className={cn("px-3 py-2 font-medium", column.numeric ? "text-right" : "text-left")}
                >
                  <button
                    type="button"
                    onClick={() => setSort((current) => nextDirection(current, column.key))}
                    className={cn(
                      "th-micro inline-flex h-6 items-center gap-1 rounded-sm text-muted hover:text-foreground",
                      column.numeric && "flex-row-reverse",
                    )}
                  >
                    {t(`columns.${column.key}`)}
                    <SortIcon active={active} direction={sort?.direction ?? "asc"} />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {ordered.map((row) => {
            const position = rows.findIndex((r) => r.index === row.index);
            return (
              <tr
                key={row.index}
                className={cn(
                  "border-b border-border last:border-b-0",
                  row.status === "pending" && "text-muted",
                )}
              >
                <td className="px-3 py-2">
                  <AlgorithmCell row={row} position={position} />
                </td>
                {COLUMNS.slice(1, -1).map((column) => {
                  const key = column.key as MetricKey;
                  const value = row[key];
                  const isBest = best[key].has(row.index);
                  return (
                    <td
                      key={key}
                      className={cn(
                        "num px-3 py-2 text-right",
                        isBest && "font-semibold text-success",
                        row.status === "running" && "text-muted",
                      )}
                    >
                      {value === null ? "—" : formatCell(key, value, locale)}
                    </td>
                  );
                })}
                <td className="px-3 py-2">
                  {row.feasible === null ? (
                    <span className="text-faint">—</span>
                  ) : (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 text-small font-medium",
                        row.feasible ? "text-success" : "text-warning",
                      )}
                    >
                      {row.feasible ? (
                        <CircleCheck size={16} strokeWidth={1.75} aria-hidden="true" />
                      ) : (
                        <TriangleAlert size={16} strokeWidth={1.75} aria-hidden="true" />
                      )}
                      {row.feasible ? t("feasible.yes") : t("feasible.no")}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
