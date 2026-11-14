"use client";

import { CircleAlert, Loader2, Play, Square, Warehouse } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useState } from "react";
import { Field } from "@/components/panels/Field";
import { Metric } from "@/components/planner/ResultsPanel";
import { RouteMapLoader } from "@/components/map/RouteMapLoader";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Num } from "@/components/ui/num";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  durationParts,
  formatMXN,
  formatSeconds,
  kmParts,
} from "@/lib/format";
import { EMPTY_FOCUS } from "@/lib/map/geojson";
import {
  OBJECTIVE_KEYS,
  toFrontPoints,
  type ObjectiveKey,
} from "@/lib/pareto/front";
import { formatObjective } from "@/lib/pareto/format";
import { cn } from "@/lib/utils";
import { usePlanner } from "@/stores/planner";
import { useParetoStore } from "@/stores/pareto";
import { ParetoChart } from "./ParetoChart";

const PADDING = { top: 32, right: 32, bottom: 32, left: 32 };

function AxisSelect({
  axis,
  value,
  disabled,
}: {
  axis: "x" | "y";
  value: ObjectiveKey;
  disabled: boolean;
}) {
  const t = useTranslations("pareto");
  const id = useId();
  const setAxis = useParetoStore((state) => state.setAxis);
  const items = OBJECTIVE_KEYS.map((key) => ({ value: key, label: t(`objectives.${key}`) }));
  return (
    <Field label={t(`axis.${axis}`)} htmlFor={id}>
      <Select
        items={items}
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          if (typeof next === "string") setAxis(axis, next as ObjectiveKey);
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function ErrorNotice({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("planner.error");
  const error = useParetoStore((state) => state.error);
  if (!error) return null;
  const known = t.has(`causes.${error.code}`);
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-lg border border-danger bg-surface p-4">
      <div className="flex items-start gap-3">
        <CircleAlert size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-semibold text-danger">{t("title")}</p>
          <p className="text-small">{known ? t(`causes.${error.code}`) : t("causes.unknown")}</p>
        </div>
      </div>
      <Collapsible>
        <CollapsibleTrigger className="text-small text-muted underline-offset-2 hover:underline">
          {t("details")}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="num mt-2 max-h-32 overflow-auto rounded-md bg-surface-2 p-2 text-micro whitespace-pre-wrap">
            {[error.code, error.message].filter(Boolean).join("\n")}
          </pre>
        </CollapsibleContent>
      </Collapsible>
      <div>
        <Button variant="outline" onClick={onRetry}>
          {t("retry")}
        </Button>
      </div>
    </div>
  );
}

export function ParetoView() {
  const t = useTranslations("pareto");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const limitId = useId();
  const scenarioId = useId();

  const problem = usePlanner((state) => state.problem);
  const catalogStatus = usePlanner((state) => state.catalogStatus);
  const scenarioLoading = usePlanner((state) => state.scenarioLoading);
  const loadCatalog = usePlanner((state) => state.loadCatalog);
  const loadScenario = usePlanner((state) => state.loadScenario);
  const scenarios = usePlanner((state) => state.scenarios);
  const adoptSolution = usePlanner((state) => state.adoptSolution);

  const status = useParetoStore((state) => state.status);
  const points = useParetoStore((state) => state.points);
  const progress = useParetoStore((state) => state.progress);
  const timeLimit = useParetoStore((state) => state.timeLimitS);
  const xKey = useParetoStore((state) => state.xKey);
  const yKey = useParetoStore((state) => state.yKey);
  const selectedId = useParetoStore((state) => state.selectedId);
  const setTimeLimit = useParetoStore((state) => state.setTimeLimit);
  const select = useParetoStore((state) => state.select);
  const run = useParetoStore((state) => state.run);
  const stop = useParetoStore((state) => state.stop);

  const [fitNonce, setFitNonce] = useState(1);
  const running = status === "running";

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const front = useMemo(() => toFrontPoints(points, xKey, yKey), [points, xKey, yKey]);
  const ordered = useMemo(
    () => [...front].sort((a, b) => a.x - b.x || a.y - b.y),
    [front],
  );
  const selected = front.find((point) => point.id === selectedId) ?? null;
  const solution = selected?.source.solution ?? null;
  const limitInvalid = timeLimit === null || !(timeLimit > 0) || timeLimit > 600;

  const launch = () => {
    if (problem) void run(problem);
  };

  const scenarioItems = scenarios.map((scenario) => ({ value: scenario.id, label: scenario.name }));
  const currentScenario = scenarios.find((scenario) => scenario.name === problem?.name)?.id ?? null;

  const changeScenario = (id: string) => {
    useParetoStore.setState({ points: [], status: "idle", selectedId: null, error: null });
    void loadScenario(id);
  };

  const choose = (id: string) => {
    select(id);
    setFitNonce((n) => n + 1);
  };

  const useInPlanner = () => {
    if (!solution) return;
    adoptSolution(solution);
    router.push("/planner");
  };

  if (!problem) {
    return (
      <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-4 py-16">
        <h1 className="text-h1 font-semibold tracking-[-0.01em]">{t("title")}</h1>
        <p className="max-w-prose text-muted">{t("noProblem")}</p>
        <div className="flex gap-2">
          <Button
            disabled={catalogStatus !== "ready" || scenarioLoading}
            onClick={() => void loadScenario()}
          >
            {scenarioLoading ? (
              <Loader2 size={16} strokeWidth={1.75} className="animate-spin" aria-hidden="true" />
            ) : (
              <Warehouse size={16} strokeWidth={1.75} aria-hidden="true" />
            )}
            {t("loadDemo")}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-col md:grid md:min-h-0 md:flex-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-5 p-4 md:min-h-0 md:overflow-y-auto md:border-r md:border-border [&>*]:shrink-0">
        <header className="flex flex-col gap-1">
          <h1 className="text-h1 font-semibold tracking-[-0.01em]">{t("title")}</h1>
          <p className="max-w-prose text-muted">{t("subtitle")}</p>
        </header>

        <section aria-label={t("controls")} className="flex flex-col gap-3">
          <Field label={t("scenario")} htmlFor={scenarioId}>
            <Select
              items={scenarioItems}
              value={currentScenario}
              disabled={running || scenarioLoading}
              onValueChange={(next) => {
                if (typeof next === "string") changeScenario(next);
              }}
            >
              <SelectTrigger id={scenarioId} className="w-full">
                <SelectValue placeholder={problem.name} />
              </SelectTrigger>
              <SelectContent>
                {scenarioItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <AxisSelect axis="x" value={xKey} disabled={false} />
            <AxisSelect axis="y" value={yKey} disabled={false} />
            <Field label={t("timeLimit")} htmlFor={limitId}>
              <div className="relative">
                <Input
                  id={limitId}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  disabled={running}
                  value={timeLimit ?? ""}
                  aria-invalid={limitInvalid ? true : undefined}
                  onChange={(event) =>
                    setTimeLimit(event.target.value === "" ? null : Number(event.target.value))
                  }
                  className="num pr-8"
                />
                <span className="num pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-micro text-muted">
                  s
                </span>
              </div>
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {running ? (
              <Button variant="outline" onClick={stop}>
                <Square size={16} strokeWidth={1.75} aria-hidden="true" />
                {t("stop")}
              </Button>
            ) : (
              <Button disabled={limitInvalid || scenarioLoading} onClick={launch}>
                <Play size={16} strokeWidth={1.75} aria-hidden="true" />
                {points.length > 0 ? t("rerun") : t("run")}
              </Button>
            )}
            <p role="status" aria-live="polite" className="text-small text-muted">
              {running
                ? progress
                  ? t("running", {
                      elapsed: formatSeconds(progress.elapsedS, locale),
                    })
                  : t("preparing")
                : points.length > 0
                  ? t("count", { count: points.length })
                  : t("idle", { stops: problem.stops.length })}
            </p>
          </div>
        </section>

        <WakeAndError onRetry={launch} />

        {points.length === 0 && !running ? (
          <p className="rounded-lg border border-dashed border-border-strong p-6 text-muted">
            {t("empty")}
          </p>
        ) : running && points.length === 0 ? (
          <Skeleton className="h-80 w-full" />
        ) : (
          <>
            <ParetoChart
              points={front}
              xKey={xKey}
              yKey={yKey}
              selectedId={selectedId}
              onSelect={choose}
            />
            {points.length === 1 && !running ? (
              <p className="text-small text-muted">{t("single")}</p>
            ) : null}
            <p className="flex flex-wrap gap-x-4 text-micro text-muted">
              <span>{t("legend.size")}</span>
              <span>{t("legend.dominated")}</span>
              <span>{t("legend.front")}</span>
            </p>

            {selected && solution ? (
              <section
                aria-label={t("card.title")}
                className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-h2 font-semibold">{t("card.title")}</h2>
                  <span className="text-small text-muted">
                    {selected.dominated ? t("dominated") : t("nonDominated")}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
                  <Metric label={t("card.time")} value={durationParts(solution.metrics.total_duration_min, locale)} />
                  <Metric label={t("card.cost")} value={formatMXN(solution.metrics.total_cost_mxn, locale)} />
                  <Metric label={t("card.vehicles")} value={String(solution.metrics.vehicles_used)} />
                  <Metric label={t("card.makespan")} value={durationParts(solution.metrics.makespan_min, locale)} />
                  <Metric label={t("card.distance")} value={kmParts(solution.metrics.total_distance_km, locale)} />
                </dl>
                <div>
                  <Button onClick={useInPlanner}>{t("useInPlanner")}</Button>
                </div>
              </section>
            ) : (
              <p className="text-small text-muted">{t("selectHint")}</p>
            )}

            <section aria-labelledby="pareto-list-title" className="flex flex-col gap-2">
              <h2 id="pareto-list-title" className="text-h2 font-semibold">
                {t("list.title")}
              </h2>
              <div className="overflow-x-auto rounded-lg border border-border bg-surface">
                <table className="w-full min-w-[28rem] text-small">
                  <caption className="sr-only">{t("list.caption")}</caption>
                  <thead>
                    <tr className="th-micro border-b border-border text-muted">
                      <th scope="col" className="px-3 py-2 text-left font-medium">
                        #
                      </th>
                      {OBJECTIVE_KEYS.map((key) => (
                        <th key={key} scope="col" className="px-3 py-2 text-right font-medium">
                          {t(`objectives.${key}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ordered.map((point, index) => (
                      <tr
                        key={point.id}
                        className={cn(
                          "border-b border-border last:border-b-0",
                          point.id === selectedId && "bg-accent-soft",
                          point.dominated && "text-muted",
                        )}
                      >
                        <td className="px-3 py-1">
                          <button
                            type="button"
                            aria-pressed={point.id === selectedId}
                            aria-label={t("list.select", { n: index + 1 })}
                            onClick={() => choose(point.id)}
                            className="num min-h-6 min-w-6 rounded-sm text-left hover:underline"
                          >
                            {index + 1}
                          </button>
                        </td>
                        {OBJECTIVE_KEYS.map((key) => (
                          <td key={key} className="num px-3 py-1 text-right">
                            {formatObjective(key, point.source.objectives[key] ?? 0, locale)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>

      <div className="relative h-[60dvh] shrink-0 md:h-auto">
        <RouteMapLoader
          className="absolute inset-0"
          problem={problem}
          solution={solution}
          focus={EMPTY_FOCUS}
          padding={PADDING}
          fitNonce={fitNonce}
        />
        {!solution ? (
          <p className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-border bg-surface px-3 py-2 text-small text-muted shadow-sm">
            <Num>{problem.stops.length}</Num> {t("mapHint")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function WakeAndError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("planner.wake");
  const wakeSince = useParetoStore((state) => state.wakeSince);
  return (
    <>
      {wakeSince !== null ? (
        <div role="status" className="rounded-lg border border-border bg-surface px-4 py-3 text-sm font-medium">
          {t("title")}
        </div>
      ) : null}
      <ErrorNotice onRetry={onRetry} />
    </>
  );
}
