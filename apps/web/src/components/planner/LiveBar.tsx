"use client";

import { Sparkles, Square } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Sparkline } from "@/components/charts/Sparkline";
import { AlgorithmChip } from "@/components/ui/algorithm-chip";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Num } from "@/components/ui/num";
import type { Locale } from "@/i18n/routing";
import { formatFitness, formatSeconds } from "@/lib/format";
import { useCountUp } from "@/lib/motion/use-count-up";
import { useTransient } from "@/lib/motion/use-transient";
import { stageKind } from "@/lib/planner/algorithms";
import { cn } from "@/lib/utils";
import { usePlanner } from "@/stores/planner";
import { useRunFraction } from "./use-run-fraction";
import { useStageLabel } from "./use-stage-label";

const IMPROVEMENT_VISIBLE_MS = 1500;
const PULSE_MS = 600;

export function LiveBar({ className }: { className?: string }) {
  const t = useTranslations("planner.live");
  const locale = useLocale() as Locale;
  const status = usePlanner((state) => state.status);
  const progress = usePlanner((state) => state.progress);
  const history = usePlanner((state) => state.history);
  const algorithm = usePlanner((state) => state.algorithm);
  const improvement = usePlanner((state) => state.improvement);
  const maxIterations = usePlanner((state) => {
    const value = state.paramValues.max_iterations;
    return typeof value === "number" ? value : null;
  });
  const stop = usePlanner((state) => state.stop);
  const stageText = useStageLabel();
  const fraction = useRunFraction();
  const bestFitness = useCountUp(progress?.bestFitness ?? 0, 300);
  const badgeVisible = useTransient(improvement.nonce, IMPROVEMENT_VISIBLE_MS);
  const pulsing = useTransient(improvement.nonce, PULSE_MS);

  if (status !== "loading" && status !== "running") return null;

  const counter = progress
    ? t(`stage.${stageKind(algorithm)}`, {
        iteration: progress.iteration,
        max: maxIterations ?? "—",
      })
    : null;
  const stage = stageText ?? counter ?? t("preparing");
  const sourceName = improvement.source ? improvement.source.toUpperCase() : null;

  return (
    <section
      aria-label={t("title")}
      className={cn(
        "relative flex flex-wrap items-center gap-x-6 gap-y-2 overflow-hidden rounded-lg border border-border bg-surface px-4 py-3 shadow-sm",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1">
          <AlgorithmChip algorithm={algorithm} />
          <InfoTip topic={`algorithms.${algorithm}`} className="-my-1" />
        </span>
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
          <dt className="th-micro flex items-center gap-0.5 text-muted">
            {t("bestFitness")}
            <InfoTip topic="metrics.fitness" className="-my-1" />
          </dt>
          <dd className="num text-sm">
            {progress ? formatFitness(bestFitness, locale) : "—"}
          </dd>
        </div>
      </dl>
      <div className="flex items-center gap-2">
        <div
          key={improvement.nonce}
          className={cn("hidden rounded-md sm:block", improvement.nonce > 0 && "signal-pulse")}
        >
          <Sparkline
            values={history.map((point) => point.best_fitness)}
            label={t("convergence")}
            highlight={pulsing}
          />
        </div>
        <span
          aria-live="polite"
          className={cn(
            "hidden h-6 items-center gap-1 rounded-full bg-signal/20 px-2 text-micro font-medium text-foreground transition-opacity duration-[180ms] sm:inline-flex",
            badgeVisible ? "opacity-100" : "opacity-0",
          )}
        >
          <Sparkles size={12} strokeWidth={1.75} aria-hidden="true" />
          {badgeVisible
            ? sourceName
              ? t("improvedBy", { source: sourceName })
              : t("improved")
            : null}
        </span>
      </div>
      <Button variant="outline" onClick={stop} className="ml-auto">
        <Square size={16} strokeWidth={1.75} aria-hidden="true" />
        {t("stop")}
      </Button>
      <div
        role="progressbar"
        aria-label={t("progressLabel")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
        className="absolute inset-x-0 bottom-0 h-0.5 bg-surface-2"
      >
        <div
          className={cn(
            "h-full origin-left transition-transform duration-[200ms] ease-linear",
            pulsing ? "bg-signal" : "bg-accent",
          )}
          style={{ transform: `scaleX(${fraction})` }}
        />
      </div>
    </section>
  );
}
