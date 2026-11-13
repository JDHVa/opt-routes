"use client";

import { ChevronDown, CircleCheck, TriangleAlert, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Num } from "@/components/ui/num";
import type { Locale } from "@/i18n/routing";
import type { Problem, Route, Solution } from "@/lib/api/types";
import {
  durationParts,
  formatClock,
  formatKm,
  kmParts,
  type ValuePart,
  formatMinutes,
  formatMXN,
  formatSeconds,
} from "@/lib/format";
import { algorithmDisplayName } from "@/lib/planner/algorithms";
import { isInfeasible } from "@/lib/planner/derive";
import { routeColor, routeIsDashed } from "@/lib/routes/palette";
import { cn } from "@/lib/utils";
import { usePlanner } from "@/stores/planner";

function Metric({ label, value }: { label: string; value: string | ValuePart[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-micro font-medium text-muted">{label}</dt>
      <dd className="flex flex-wrap items-baseline gap-x-1.5 text-metric font-medium">
        {typeof value === "string" ? (
          <span className="num">{value}</span>
        ) : (
          value.map((part) => (
            <span key={part.unit} className="whitespace-nowrap">
              <span className="num">{part.value}</span>
              <span className="ml-0.5 text-small font-normal text-muted">{part.unit}</span>
            </span>
          ))
        )}
      </dd>
    </div>
  );
}

function RouteItem({
  problem,
  route,
  driverIndex,
  selected,
}: {
  problem: Problem;
  route: Route;
  driverIndex: number;
  selected: boolean;
}) {
  const t = useTranslations("planner.results");
  const locale = useLocale() as Locale;
  const selectRoute = usePlanner((state) => state.selectRoute);
  const hoverRoute = usePlanner((state) => state.hoverRoute);
  const selectStop = usePlanner((state) => state.selectStop);
  const driver = problem.drivers[driverIndex];
  const name = driver?.name ?? t("driverName", { n: driverIndex + 1 });
  const stopsById = new Map(problem.stops.map((s) => [s.id, s]));
  const color = routeColor(driverIndex);
  const dashed = routeIsDashed(driverIndex);

  return (
    <li
      className="border-b border-border last:border-b-0"
      onMouseEnter={() => hoverRoute(driverIndex)}
      onMouseLeave={() => hoverRoute(null)}
    >
      <button
        type="button"
        aria-expanded={selected}
        aria-pressed={selected}
        onClick={() => selectRoute(driverIndex)}
        className={cn(
          "grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2 text-left transition-colors duration-[120ms]",
          selected ? "bg-accent-soft" : "hover:bg-surface-2",
        )}
      >
        <span
          aria-hidden="true"
          className="h-1 w-5 rounded-full"
          style={
            dashed
              ? { backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 6px, transparent 6px 9px)` }
              : { backgroundColor: color }
          }
        />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">
            <Num className="text-muted">{driverIndex + 1}</Num> {name}
          </span>
          <span className="flex flex-wrap gap-x-2 text-micro text-muted">
            <span className="whitespace-nowrap">
              <Num>{route.visits.length}</Num> {t("stops", { count: route.visits.length })}
            </span>
            <Num className="whitespace-nowrap">{formatKm(route.metrics.distance_km, locale)}</Num>
            <Num className="whitespace-nowrap">{formatMinutes(route.metrics.duration_min, locale)}</Num>
          </span>
        </span>
        <ChevronDown
          size={16}
          strokeWidth={1.75}
          aria-hidden="true"
          className={cn("text-muted transition-transform duration-[160ms]", selected && "rotate-180")}
        />
      </button>
      {selected ? (
        <div className="overflow-x-auto px-4 pb-3">
          <table className="w-full text-small">
            <caption className="sr-only">{t("itineraryFor", { name })}</caption>
            <thead>
              <tr className="th-micro text-left text-muted">
                <th scope="col" className="py-2 pr-3 font-medium">#</th>
                <th scope="col" className="py-2 pr-3 font-medium">{t("stop")}</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">{t("eta")}</th>
                <th scope="col" className="py-2 text-right font-medium">{t("late")}</th>
              </tr>
            </thead>
            <tbody>
              {route.visits.map((visit, order) => (
                <tr
                  key={visit.stop_id}
                  className="cursor-pointer border-t border-border hover:bg-surface-2"
                  onClick={() => selectStop(visit.stop_id)}
                  title={stopsById.get(visit.stop_id)?.location.address ?? undefined}
                >
                  <td className="num py-2 pr-3 text-muted">{order + 1}</td>
                  <td className="num py-2 pr-3">{visit.stop_id}</td>
                  <td className="num py-2 pr-3 text-right">{formatClock(visit.arrival_min)}</td>
                  <td
                    className={cn(
                      "num py-2 text-right",
                      visit.late_min > 0 ? "font-medium text-warning" : "text-faint",
                    )}
                  >
                    {visit.late_min > 0 ? formatMinutes(visit.late_min, locale) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </li>
  );
}

export function ResultsPanel({
  solution,
  problem,
  onClose,
}: {
  solution: Solution;
  problem: Problem;
  onClose?: () => void;
}) {
  const t = useTranslations("planner.results");
  const locale = useLocale() as Locale;
  const selectedRoute = usePlanner((state) => state.selectedRoute);
  const stopped = usePlanner((state) => state.stopped);
  const status = usePlanner((state) => state.status);
  const metrics = solution.metrics;
  const infeasible = isInfeasible(metrics);
  const live = status === "running";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-border p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-h2 font-semibold">{t("title")}</h2>
          <p className="flex flex-wrap items-center gap-x-2 text-small text-muted">
            <span>{algorithmDisplayName(solution.algorithm)}</span>
            <span aria-hidden="true">·</span>
            <Num>{formatSeconds(solution.runtime_s, locale)}</Num>
            {stopped ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{t("stopped")}</span>
              </>
            ) : null}
            {live ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{t("partial")}</span>
              </>
            ) : null}
          </p>
          <p
            className={cn(
              "flex items-center gap-1 text-small font-medium",
              infeasible ? "text-warning" : "text-success",
            )}
          >
            {infeasible ? (
              <TriangleAlert size={16} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <CircleCheck size={16} strokeWidth={1.75} aria-hidden="true" />
            )}
            {infeasible ? t("infeasible") : t("feasible")}
          </p>
        </div>
        {onClose ? (
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t("close")}>
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-b border-border p-4">
          <Metric label={t("metrics.distance")} value={kmParts(metrics.total_distance_km, locale)} />
          <Metric label={t("metrics.cost")} value={formatMXN(metrics.total_cost_mxn, locale)} />
          <Metric label={t("metrics.duration")} value={durationParts(metrics.total_duration_min, locale)} />
          <Metric label={t("metrics.makespan")} value={durationParts(metrics.makespan_min, locale)} />
          <Metric label={t("metrics.vehicles")} value={String(metrics.vehicles_used)} />
          <Metric label={t("metrics.lateness")} value={durationParts(metrics.lateness_min, locale)} />
        </dl>

        <div className="flex flex-col">
          <h3 className="th-micro px-4 pt-4 pb-2 text-muted">{t("routes")}</h3>
          <ul className="border-t border-border">
            {solution.routes.map((route) => {
              const driverIndex = problem.drivers.findIndex((d) => d.id === route.driver_id);
              return (
                <RouteItem
                  key={route.driver_id}
                  problem={problem}
                  route={route}
                  driverIndex={driverIndex}
                  selected={selectedRoute === driverIndex}
                />
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
