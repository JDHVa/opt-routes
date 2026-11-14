"use client";

import { MapPin, Pause, Play, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { Segmented } from "@/components/panels/Segmented";
import { Button } from "@/components/ui/button";
import { Num } from "@/components/ui/num";
import { formatClock } from "@/lib/format";
import { markPosition } from "@/lib/sim/plan";
import { timelineHorizon, type SimState } from "@/lib/sim/reducer";
import { cn } from "@/lib/utils";

export const SPEED_OPTIONS = [30, 60, 120, 300] as const;

export function Timeline({
  state,
  placing,
  onTogglePlacing,
  onPause,
  onResume,
  onSpeed,
  onStop,
  className,
}: {
  state: SimState;
  placing: boolean;
  onTogglePlacing: () => void;
  onPause: () => void;
  onResume: () => void;
  onSpeed: (speed: number) => void;
  onStop: () => void;
  className?: string;
}) {
  const t = useTranslations("simulate.timeline");
  const live = state.phase === "running" || state.phase === "paused";
  const horizon = timelineHorizon(state);
  const fill = markPosition(state.clock, horizon);
  const speedValue = String(state.speed);

  return (
    <section
      aria-label={t("title")}
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 shadow-sm",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-col">
          <span className="th-micro text-muted">{t("clock")}</span>
          <span
            role="timer"
            aria-label={t("clockLabel", { time: formatClock(state.clock) })}
            data-testid="sim-clock"
            className="num text-metric font-medium"
          >
            {formatClock(state.clock)}
          </span>
        </div>
        <Button
          variant="outline"
          size="icon"
          disabled={!live}
          aria-label={state.phase === "paused" ? t("resume") : t("pause")}
          onClick={state.phase === "paused" ? onResume : onPause}
        >
          {state.phase === "paused" ? (
            <Play size={16} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Pause size={16} strokeWidth={1.75} aria-hidden="true" />
          )}
        </Button>
        <div className="w-56 max-w-full">
          <Segmented
            ariaLabel={t("speed")}
            value={SPEED_OPTIONS.some((s) => String(s) === speedValue) ? speedValue : null}
            onChange={(next) => onSpeed(Number(next))}
            options={SPEED_OPTIONS.map((speed) => ({
              value: String(speed),
              label: t("speedValue", { speed }),
            }))}
          />
        </div>
        <Button
          variant={placing ? "default" : "outline"}
          aria-pressed={placing}
          disabled={!live}
          onClick={onTogglePlacing}
        >
          <MapPin size={16} strokeWidth={1.75} aria-hidden="true" />
          {placing ? t("placing") : t("addOrder")}
        </Button>
        <Button variant="outline" disabled={!live} onClick={onStop} className="ml-auto">
          <Square size={16} strokeWidth={1.75} aria-hidden="true" />
          {t("stop")}
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <div
          role="progressbar"
          aria-label={t("progress")}
          aria-valuemin={0}
          aria-valuemax={Math.round(horizon)}
          aria-valuenow={Math.round(Math.min(state.clock, horizon))}
          aria-valuetext={formatClock(state.clock)}
          className="relative h-2 rounded-full bg-surface-2"
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-accent"
            style={{ width: `${fill}%` }}
          />
          {state.marks.map((mark, index) => (
            <span
              key={`${mark.kind}-${index}`}
              data-testid={`mark-${mark.kind}`}
              title={`${formatClock(mark.clock)} · ${t(`marks.${mark.kind}`)}`}
              className={cn(
                "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 border border-surface",
                mark.kind === "order"
                  ? "h-4 w-1 rounded-full bg-foreground"
                  : "size-3 rotate-45 rounded-[2px] bg-warning",
              )}
              style={{ left: `${markPosition(mark.clock, horizon)}%` }}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 text-micro text-muted">
          <span className="flex flex-wrap gap-x-4">
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-3 w-1 rounded-full bg-foreground" />
              {t("marks.order")} <Num>{state.orders.length}</Num>
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2 rotate-45 rounded-[2px] bg-warning" />
              {t("marks.reopt")} <Num>{state.reoptCount}</Num>
            </span>
          </span>
          <Num>{formatClock(horizon)}</Num>
        </div>
      </div>
    </section>
  );
}
