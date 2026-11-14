"use client";

import { ChevronDown, CircleCheck, Download, TriangleAlert, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlgorithmChip } from "@/components/ui/algorithm-chip";
import { Metric } from "@/components/ui/metric";
import { Num } from "@/components/ui/num";
import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion/use-reduced-motion";
import { riseVariants, staggerVariants } from "@/lib/motion/variants";
import type { Locale } from "@/i18n/routing";
import { exportCsv } from "@/lib/api/client";
import { downloadText } from "@/lib/download";
import { hybridContribution } from "@/lib/planner/hybrid";
import type { Problem, Route, Solution } from "@/lib/api/types";
import {
  durationParts,
  formatClock,
  formatKm,
  kmParts,
  formatMinutes,
  formatMXN,
  formatSeconds,
} from "@/lib/format";
import { isInfeasible } from "@/lib/planner/derive";
import { ALGORITHM_COLORS, routeColor, routeIsDashed } from "@/lib/routes/palette";
import { cn } from "@/lib/utils";
import { usePlanner } from "@/stores/planner";

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
  const reduced = useReducedMotion();

  return (
    <motion.li
      variants={riseVariants(reduced, 8)}
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
    </motion.li>
  );
}

function HybridBar() {
  const t = useTranslations("planner.results.hybrid");
  const extra = usePlanner((state) => state.progress?.extra ?? null);
  const algorithm = usePlanner((state) => state.solution?.algorithm ?? null);
  const contribution = extra && algorithm === "aco_ga" ? hybridContribution(extra) : null;
  if (!contribution) return null;
  const percent = Math.round(contribution.gaShare * 100);
  return (
    <div className="flex flex-col gap-2 border-b border-border p-4">
      <h3 className="th-micro text-muted">{t("title")}</h3>
      <div
        role="img"
        aria-label={t("aria", { ga: contribution.ga, aco: contribution.aco })}
        className="flex h-2 overflow-hidden rounded-full bg-surface-2"
      >
        {contribution.ga + contribution.aco > 0 ? (
          <>
            <div style={{ width: `${percent}%`, backgroundColor: ALGORITHM_COLORS.ga }} />
            <div style={{ width: `${100 - percent}%`, backgroundColor: ALGORITHM_COLORS.aco }} />
          </>
        ) : null}
      </div>
      <p className="flex gap-4 text-small">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2 rounded-full"
            style={{ backgroundColor: ALGORITHM_COLORS.ga }}
          />
          GA <Num className="font-medium">{contribution.ga}</Num>
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2 rounded-full"
            style={{ backgroundColor: ALGORITHM_COLORS.aco }}
          />
          ACO <Num className="font-medium">{contribution.aco}</Num>
        </span>
      </p>
    </div>
  );
}

function ExportActions({ solution }: { solution: Solution }) {
  const t = useTranslations("planner.results.export");
  const [busy, setBusy] = useState(false);

  const exportAsCsv = async () => {
    setBusy(true);
    try {
      downloadText("routeopt-itinerary.csv", await exportCsv(solution), "text/csv;charset=utf-8");
    } catch {
      toast.error(t("failed"));
    } finally {
      setBusy(false);
    }
  };

  const exportAsJson = () =>
    downloadText("routeopt-solution.json", JSON.stringify(solution, null, 2), "application/json");

  return (
    <div className="flex gap-2 border-t border-border p-3">
      <Button variant="outline" className="flex-1" disabled={busy} onClick={() => void exportAsCsv()}>
        <Download size={16} strokeWidth={1.75} aria-hidden="true" />
        {t("csv")}
      </Button>
      <Button variant="outline" className="flex-1" onClick={exportAsJson}>
        <Download size={16} strokeWidth={1.75} aria-hidden="true" />
        {t("json")}
      </Button>
    </div>
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
  const reduced = useReducedMotion();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-border p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-h2 font-semibold">{t("title")}</h2>
          <p className="flex flex-wrap items-center gap-x-2 text-small text-muted">
            <AlgorithmChip algorithm={solution.algorithm} />
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
        <motion.dl
          initial="hidden"
          animate="show"
          variants={staggerVariants(reduced, 0.04)}
          className="grid grid-cols-2 gap-x-4 gap-y-4 border-b border-border p-4"
        >
          <Metric
            label={t("metrics.distance")}
            help="metrics.distance"
            amount={metrics.total_distance_km}
            format={(n) => kmParts(n, locale)}
          />
          <Metric
            label={t("metrics.cost")}
            help="metrics.cost"
            amount={metrics.total_cost_mxn}
            format={(n) => formatMXN(n, locale)}
          />
          <Metric
            label={t("metrics.duration")}
            help="metrics.duration"
            amount={metrics.total_duration_min}
            format={(n) => durationParts(n, locale)}
          />
          <Metric
            label={t("metrics.makespan")}
            help="metrics.makespan"
            amount={metrics.makespan_min}
            format={(n) => durationParts(n, locale)}
          />
          <Metric
            label={t("metrics.vehicles")}
            help="metrics.vehicles"
            amount={metrics.vehicles_used}
            format={(n) => String(Math.round(n))}
          />
          <Metric
            label={t("metrics.lateness")}
            help="metrics.lateness"
            amount={metrics.lateness_min}
            format={(n) => durationParts(n, locale)}
          />
        </motion.dl>

        <HybridBar />

        <div className="flex flex-col">
          <h3 className="th-micro px-4 pt-4 pb-2 text-muted">{t("routes")}</h3>
          <motion.ul
            initial="hidden"
            animate="show"
            variants={staggerVariants(reduced, 0.04, 0.2)}
            className="border-t border-border"
          >
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
          </motion.ul>
        </div>
      </div>
      {!live ? <ExportActions solution={solution} /> : null}
    </div>
  );
}
