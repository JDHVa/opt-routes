"use client";

import { CircleCheck, Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Metric } from "@/components/planner/ResultsPanel";
import { Button } from "@/components/ui/button";
import { Num } from "@/components/ui/num";
import type { Locale } from "@/i18n/routing";
import { durationParts, formatClock, kmParts, formatMXN } from "@/lib/format";
import { algorithmDisplayName } from "@/lib/planner/algorithms";
import { isInfeasible } from "@/lib/planner/derive";
import type { SimConfigForm } from "@/lib/sim/config";
import type { SimState } from "@/lib/sim/reducer";
import { cn } from "@/lib/utils";

function Summary({ state }: { state: SimState }) {
  const t = useTranslations("simulate.summary");
  const locale = useLocale() as Locale;
  const metrics = state.metrics;
  if (!metrics) return null;
  const infeasible = isInfeasible(metrics);
  return (
    <section aria-label={t("title")} className="flex flex-col gap-4" data-testid="sim-summary">
      <div className="flex flex-col gap-1">
        <h2 className="text-h2 font-semibold">{t("title")}</h2>
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
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
        <Metric label={t("distance")} value={kmParts(metrics.total_distance_km, locale)} />
        <Metric label={t("cost")} value={formatMXN(metrics.total_cost_mxn, locale)} />
        <Metric label={t("duration")} value={durationParts(metrics.total_duration_min, locale)} />
        <Metric label={t("makespan")} value={durationParts(metrics.makespan_min, locale)} />
        <Metric label={t("vehicles")} value={String(metrics.vehicles_used)} />
        <Metric label={t("lateness")} value={durationParts(metrics.lateness_min, locale)} />
        {metrics.unassigned > 0 ? (
          <Metric label={t("unassigned")} value={String(metrics.unassigned)} />
        ) : null}
      </dl>
      <p className="text-small text-muted">
        {t("counts", { orders: state.orders.length, reopts: state.reoptCount })}
      </p>
    </section>
  );
}

export function SimStatusPanel({
  state,
  form,
  scenarioName,
  totalStops,
  onReset,
}: {
  state: SimState;
  form: SimConfigForm;
  scenarioName: string;
  totalStops: number;
  onReset: () => void;
}) {
  const t = useTranslations("simulate.status");
  const done = state.phase === "done";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-4">
          {done ? (
            <Summary state={state} />
          ) : (
            <div className="flex flex-col gap-1">
              <h2 className="text-h2 font-semibold">{t(`phase.${state.phase}`)}</h2>
              {state.phase === "connecting" ? (
                <p
                  role="status"
                  className="flex items-center gap-2 text-small text-muted"
                >
                  <Loader2 size={16} strokeWidth={1.75} className="animate-spin" aria-hidden="true" />
                  {t("planning")}
                </p>
              ) : null}
            </div>
          )}

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-small">
            <dt className="text-muted">{t("scenario")}</dt>
            <dd className="min-w-0 truncate">{scenarioName}</dd>
            <dt className="text-muted">{t("algorithm")}</dt>
            <dd>{algorithmDisplayName(form.algorithm)}</dd>
            <dt className="text-muted">{t("trigger")}</dt>
            <dd>
              {form.trigger === "batch"
                ? t("batch", { minutes: form.batchMinutes ?? 0 })
                : t("event")}
            </dd>
            <dt className="text-muted">{t("clock")}</dt>
            <dd>
              <Num>{formatClock(state.clock)}</Num>
            </dd>
            <dt className="text-muted">{t("delivered")}</dt>
            <dd>
              <Num data-testid="sim-delivered">
                {state.delivered.length}/{totalStops}
              </Num>
            </dd>
          </dl>
        </div>
      </div>
      {done ? (
        <div className="border-t border-border p-4">
          <Button size="lg" className="w-full" onClick={onReset}>
            <RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />
            {t("newSimulation")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
