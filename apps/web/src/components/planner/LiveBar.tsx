"use client";

import { Square } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Sparkline } from "@/components/charts/Sparkline";
import { Button } from "@/components/ui/button";
import { Num } from "@/components/ui/num";
import type { Locale } from "@/i18n/routing";
import { formatFitness, formatSeconds } from "@/lib/format";
import { algorithmDisplayName, stageKind } from "@/lib/planner/algorithms";
import { usePlanner } from "@/stores/planner";
import { useStageLabel } from "./use-stage-label";

export function LiveBar({ className }: { className?: string }) {
  const t = useTranslations("planner.live");
  const locale = useLocale() as Locale;
  const status = usePlanner((state) => state.status);
  const progress = usePlanner((state) => state.progress);
  const history = usePlanner((state) => state.history);
  const algorithm = usePlanner((state) => state.algorithm);
  const maxIterations = usePlanner((state) => {
    const value = state.paramValues.max_iterations;
    return typeof value === "number" ? value : null;
  });
  const stop = usePlanner((state) => state.stop);
  const stageText = useStageLabel();

  if (status !== "loading" && status !== "running") return null;

  const counter = progress
    ? t(`stage.${stageKind(algorithm)}`, {
        iteration: progress.iteration,
        max: maxIterations ?? "—",
      })
    : null;
  const stage = stageText ?? counter ?? t("preparing");

  return (
    <section
      aria-label={t("title")}
      className={`flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3 shadow-sm ${className ?? ""}`}
    >
      <div className="flex min-w-0 flex-col">
        <span className="th-micro text-muted">{algorithmDisplayName(algorithm)}</span>
        <span role="status" aria-live="polite" className="text-sm font-medium">
          <Num>{stage}</Num>
        </span>
      </div>
      <dl className="flex gap-6">
        {stageText && counter ? (
          <div className="flex flex-col">
            <dt className="th-micro text-muted">{t("progress")}</dt>
            <dd className="num text-sm">{counter}</dd>
          </div>
        ) : null}
        <div className="flex flex-col">
          <dt className="th-micro text-muted">{t("elapsed")}</dt>
          <dd className="num text-sm">
            {progress ? formatSeconds(progress.elapsedS, locale) : "—"}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="th-micro text-muted">{t("bestFitness")}</dt>
          <dd className="num text-sm">
            {progress ? formatFitness(progress.bestFitness, locale) : "—"}
          </dd>
        </div>
      </dl>
      <div className="hidden sm:block">
        <Sparkline
          values={history.map((point) => point.best_fitness)}
          label={t("convergence")}
        />
      </div>
      <Button variant="outline" onClick={stop} className="ml-auto">
        <Square size={16} strokeWidth={1.75} aria-hidden="true" />
        {t("stop")}
      </Button>
    </section>
  );
}
