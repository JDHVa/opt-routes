"use client";

import { CircleAlert, Loader2, Play, Square } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useState } from "react";
import { Field } from "@/components/panels/Field";
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
import { Switch } from "@/components/ui/switch";
import type { Locale } from "@/i18n/routing";
import { formatSeconds } from "@/lib/format";
import { algorithmDisplayName } from "@/lib/planner/algorithms";
import { buildParamFields, validateParams } from "@/lib/planner/params-form";
import {
  PLANNER_SOURCE,
  runIsValid,
  useCompare,
} from "@/stores/compare";
import { DEMO_SCENARIO_ID, usePlanner } from "@/stores/planner";
import { CompareTable } from "./CompareTable";
import { ConvergenceChart } from "./ConvergenceChart";
import { MiniMaps } from "./MiniMaps";
import { RunsEditor } from "./RunsEditor";

function WakeNotice({ since }: { since: number }) {
  const t = useTranslations("planner.wake");
  const locale = useLocale() as Locale;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <div role="status" className="flex flex-col rounded-lg border border-border bg-surface px-4 py-3">
      <span className="text-sm font-medium">{t("title")}</span>
      <span className="text-small text-muted">
        {t("elapsed")} <Num>{formatSeconds(seconds, locale)}</Num>
      </span>
    </div>
  );
}

function ErrorNotice({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("planner.error");
  const error = useCompare((state) => state.error);
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
            {[error.code, error.message, error.detail].filter(Boolean).join("\n")}
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

export function CompareView() {
  const t = useTranslations("compare");
  const sourceId = useId();
  const limitId = useId();
  const algorithms = usePlanner((state) => state.algorithms);
  const scenarios = usePlanner((state) => state.scenarios);
  const catalogStatus = usePlanner((state) => state.catalogStatus);
  const loadCatalog = usePlanner((state) => state.loadCatalog);
  const plannerProblem = usePlanner((state) => state.problem);

  const runs = useCompare((state) => state.runs);
  const source = useCompare((state) => state.sourceId);
  const scenarioProblem = useCompare((state) => state.scenarioProblem);
  const scenarioLoading = useCompare((state) => state.scenarioLoading);
  const timeLimit = useCompare((state) => state.timeLimitS);
  const status = useCompare((state) => state.status);
  const results = useCompare((state) => state.results);
  const wakeSince = useCompare((state) => state.wakeSince);
  const initRuns = useCompare((state) => state.initRuns);
  const setSource = useCompare((state) => state.setSource);
  const setTimeLimit = useCompare((state) => state.setTimeLimit);
  const start = useCompare((state) => state.start);
  const stop = useCompare((state) => state.stop);

  const [showMaps, setShowMaps] = useState(false);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    initRuns(algorithms);
  }, [algorithms, initRuns]);

  useEffect(() => {
    const current = useCompare.getState();
    if (current.sourceId === PLANNER_SOURCE && plannerProblem === null) {
      void setSource(DEMO_SCENARIO_ID);
    }
  }, [plannerProblem, setSource]);

  const problem = source === PLANNER_SOURCE ? plannerProblem : scenarioProblem;
  const running = status === "running";
  const allValid = useMemo(
    () => runs.length > 0 && runs.every((run) => runIsValid(run, algorithms)),
    [runs, algorithms],
  );
  const limitError = useMemo(() => {
    const info = algorithms.find((a) => a.name === runs[0]?.algorithm);
    if (!info || timeLimit === null) return null;
    const fields = buildParamFields(info.params_schema).filter((f) => f.key === "time_limit_s");
    return validateParams(fields, { time_limit_s: timeLimit }).errors.time_limit_s ?? null;
  }, [algorithms, runs, timeLimit]);
  const t2 = useTranslations("planner.algorithm");

  const sourceItems = [
    ...(plannerProblem
      ? [
          {
            value: PLANNER_SOURCE,
            label: t("source.planner", { count: plannerProblem.stops.length }),
          },
        ]
      : []),
    ...scenarios.map((scenario) => ({ value: scenario.id, label: scenario.name })),
  ];

  const launch = () => {
    if (problem) void start(problem);
  };

  const ready = catalogStatus === "ready" && runs.length > 0;
  const hasResults = results.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1 font-semibold tracking-[-0.01em]">{t("title")}</h1>
        <p className="max-w-prose text-muted">{t("subtitle")}</p>
      </header>

      {!ready ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label={t("loading")}>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <section className="flex flex-col gap-4" aria-label={t("config")}>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <Field label={t("source.label")} htmlFor={sourceId}>
              <Select
                items={sourceItems}
                value={source}
                disabled={running}
                onValueChange={(next) => {
                  if (typeof next === "string") void setSource(next);
                }}
              >
                <SelectTrigger id={sourceId} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sourceItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label={t("timeLimit")}
              htmlFor={limitId}
              error={
                limitError
                  ? t2(`errors.${limitError.code}`, { bound: limitError.bound ?? 0 })
                  : undefined
              }
            >
              <div className="relative">
                <Input
                  id={limitId}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  disabled={running}
                  value={timeLimit ?? ""}
                  aria-invalid={limitError ? true : undefined}
                  aria-describedby={limitError ? `${limitId}-error` : undefined}
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

          <RunsEditor algorithms={algorithms} disabled={running} />

          <div className="flex flex-wrap items-center gap-3">
            {running ? (
              <Button variant="outline" onClick={stop}>
                <Square size={16} strokeWidth={1.75} aria-hidden="true" />
                {t("stop")}
              </Button>
            ) : (
              <Button disabled={!problem || scenarioLoading || !allValid} onClick={launch}>
                {scenarioLoading ? (
                  <Loader2 size={16} strokeWidth={1.75} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Play size={16} strokeWidth={1.75} aria-hidden="true" />
                )}
                {t("run", { count: runs.length })}
              </Button>
            )}
            {running ? (
              <p role="status" aria-live="polite" className="text-small text-muted">
                {t("progress", {
                  done: results.filter((r) => r.status === "done").length,
                  total: results.length,
                })}
              </p>
            ) : null}
            {problem ? (
              <p className="text-small text-muted">
                <Num>{problem.stops.length}</Num> {t("stops", { count: problem.stops.length })} ·{" "}
                <Num>{problem.drivers.length}</Num>{" "}
                {t("drivers", { count: problem.drivers.length })}
              </p>
            ) : null}
          </div>
        </section>
      )}

      {wakeSince !== null ? <WakeNotice since={wakeSince} /> : null}
      <ErrorNotice onRetry={launch} />

      {hasResults ? (
        <>
          <section className="flex flex-col gap-3" aria-labelledby="compare-results-title">
            <h2 id="compare-results-title" className="text-h2 font-semibold">
              {t("results")}
            </h2>
            <CompareTable runs={results} running={running} />
            <p className="text-micro text-muted">{t("gapNote")}</p>
          </section>
          <ConvergenceChart runs={results} />
          {problem ? (
            <section className="flex flex-col gap-3" aria-labelledby="minimaps-title">
              <div className="flex items-center justify-between gap-3">
                <h2 id="minimaps-title" className="text-h2 font-semibold">
                  {t("minimaps.title")}
                </h2>
                <label className="flex items-center gap-2 text-small">
                  <Switch checked={showMaps} onCheckedChange={setShowMaps} />
                  {t("minimaps.show")}
                </label>
              </div>
              {showMaps ? <MiniMaps problem={problem} runs={results} /> : null}
            </section>
          ) : null}
        </>
      ) : (
        <p className="rounded-lg border border-dashed border-border-strong p-6 text-muted">
          {t("empty", {
            algorithms: runs.map((run) => algorithmDisplayName(run.algorithm)).join(", "),
          })}
        </p>
      )}
    </div>
  );
}
