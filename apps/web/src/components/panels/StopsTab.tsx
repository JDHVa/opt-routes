"use client";

import { Dices, FileUp, Warehouse } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Num } from "@/components/ui/num";
import { Skeleton } from "@/components/ui/skeleton";
import type { Locale } from "@/i18n/routing";
import { importCsv } from "@/lib/api/client";
import { formatKg } from "@/lib/format";
import { routeColor } from "@/lib/routes/palette";
import { cn } from "@/lib/utils";
import { usePlanner } from "@/stores/planner";

const PAGE_SIZE = 50;

export function StopsTab() {
  const t = useTranslations("planner.stops");
  const locale = useLocale() as Locale;
  const fileRef = useRef<HTMLInputElement>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const problem = usePlanner((state) => state.problem);
  const solution = usePlanner((state) => state.solution);
  const loading = usePlanner((state) => state.scenarioLoading);
  const selectedStopId = usePlanner((state) => state.selectedStopId);
  const loadScenario = usePlanner((state) => state.loadScenario);
  const loadProblem = usePlanner((state) => state.loadProblem);
  const selectStop = usePlanner((state) => state.selectStop);

  const routeOfStop = useMemo(() => {
    const map = new Map<string, number>();
    if (problem && solution) {
      for (const route of solution.routes) {
        const index = problem.drivers.findIndex((d) => d.id === route.driver_id);
        for (const visit of route.visits) map.set(visit.stop_id, index);
      }
    }
    return map;
  }, [problem, solution]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      loadProblem(await importCsv(file));
    } catch {
      toast.error(t("importFailed"));
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label={t("loading")}>
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (!problem) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-h2 font-semibold">{t("emptyTitle")}</h3>
          <p className="text-muted">{t("emptyBody")}</p>
        </div>
        <div className="flex flex-col gap-2">
          <Button onClick={() => void loadScenario()}>
            <Warehouse size={16} strokeWidth={1.75} aria-hidden="true" />
            {t("loadDemo")}
          </Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <FileUp size={16} strokeWidth={1.75} aria-hidden="true" />
            {t("importCsv")}
          </Button>
          <Button variant="outline" onClick={() => toast.info(t("generateSoon"))}>
            <Dices size={16} strokeWidth={1.75} aria-hidden="true" />
            {t("generate")}
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          aria-label={t("importCsv")}
          onChange={(event) => void onFile(event.target.files?.[0])}
        />
      </div>
    );
  }

  const high = problem.stops.filter((stop) => stop.priority === "high").length;
  const visible = problem.stops.slice(0, limit);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">
          <Num>{problem.stops.length}</Num> {t("count", { count: problem.stops.length })}
        </h3>
        {high > 0 ? (
          <span className="text-small text-muted">
            <Num>{high}</Num> {t("highPriority", { count: high })}
          </span>
        ) : null}
      </div>
      <ul className="-mx-4 flex flex-col border-y border-border">
        {visible.map((stop) => {
          const driverIndex = routeOfStop.get(stop.id);
          const selected = selectedStopId === stop.id;
          return (
            <li key={stop.id} className="border-b border-border last:border-b-0">
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => selectStop(selected ? null : stop.id)}
                className={cn(
                  "grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2 text-left transition-colors duration-[120ms]",
                  selected ? "bg-accent-soft" : "hover:bg-surface-2",
                )}
              >
                <span className="flex w-14 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      driverIndex === undefined && "border border-border-strong",
                    )}
                    style={
                      driverIndex !== undefined
                        ? { backgroundColor: routeColor(driverIndex) }
                        : undefined
                    }
                  />
                  <Num className="text-small">{stop.id}</Num>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-small">
                    {stop.location.address ?? t("noAddress")}
                  </span>
                  {driverIndex !== undefined ? (
                    <span className="block text-micro text-muted">
                      {t("assignedTo", { driver: driverIndex + 1 })}
                    </span>
                  ) : null}
                </span>
                <span className="flex items-center gap-2">
                  {stop.priority !== "normal" ? (
                    <span
                      className={cn(
                        "rounded-sm px-1.5 text-micro font-medium",
                        stop.priority === "high"
                          ? "bg-danger/10 text-danger"
                          : "bg-surface-2 text-muted",
                      )}
                    >
                      {t(`priorities.${stop.priority}`)}
                    </span>
                  ) : null}
                  <Num className="text-micro text-muted">{formatKg(stop.demand_kg, locale)}</Num>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {limit < problem.stops.length ? (
        <Button variant="outline" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
          {t("showMore", { count: Math.min(PAGE_SIZE, problem.stops.length - limit) })}
        </Button>
      ) : null}
    </div>
  );
}
