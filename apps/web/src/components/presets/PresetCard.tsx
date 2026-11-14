"use client";

import { ArrowRight, Gauge, Map as MapIcon, Radio } from "lucide-react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useReducedMotion } from "@/lib/motion/use-reduced-motion";
import { riseVariants } from "@/lib/motion/variants";
import { algorithmDisplayName } from "@/lib/planner/algorithms";
import {
  presetHref,
  silhouetteFor,
  type StartPreset,
  type StartPresetTarget,
} from "@/lib/presets";
import { algorithmSeriesStyle } from "@/lib/routes/palette";
import { cn } from "@/lib/utils";
import { PresetMinimap } from "./PresetMinimap";

const TARGET_ICON = {
  planner: MapIcon,
  pareto: Gauge,
  simulate: Radio,
} satisfies Record<StartPresetTarget, typeof MapIcon>;

function Chip({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border bg-surface px-2 text-micro text-foreground">
      {color ? (
        <span
          aria-hidden="true"
          className="size-2 rounded-full"
          style={{ backgroundColor: color }}
        />
      ) : null}
      {children}
    </span>
  );
}

export function PresetCard({
  preset,
  variant = "full",
}: {
  preset: StartPreset;
  variant?: "full" | "compact";
}) {
  const t = useTranslations("startPresets");
  const reduced = useReducedMotion();
  const name = t(`items.${preset.id}.name`);
  const color = algorithmSeriesStyle(preset.algorithm).color;
  const stops = silhouetteFor(preset.scenarioId)?.stops.length ?? 0;
  const TargetIcon = TARGET_ICON[preset.target];

  const chips = (
    <div className="flex flex-wrap gap-1.5">
      <Chip color={color}>{algorithmDisplayName(preset.algorithm)}</Chip>
      <Chip>
        <span className="num">{t("stops", { count: stops })}</span>
      </Chip>
    </div>
  );

  if (variant === "compact") {
    return (
      <motion.li variants={riseVariants(reduced, 6)}>
        <Link
          href={presetHref(preset)}
          aria-label={t("tryNamed", { name })}
          className="group flex items-center gap-3 rounded-lg border border-border bg-surface p-2 transition-[border-color,background-color,transform] duration-[120ms] hover:-translate-y-px hover:border-accent hover:bg-accent-soft"
        >
          <span className="flex h-12 w-20 shrink-0 items-center justify-center rounded-md bg-surface-2">
            <PresetMinimap scenarioId={preset.scenarioId} color={color} className="size-full" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="line-clamp-2 text-small font-semibold">{name}</span>
            {chips}
          </span>
          <ArrowRight
            size={16}
            strokeWidth={1.75}
            aria-hidden="true"
            className="shrink-0 text-muted transition-transform duration-[120ms] group-hover:translate-x-0.5 group-hover:text-accent"
          />
        </Link>
      </motion.li>
    );
  }

  return (
    <motion.li variants={riseVariants(reduced, 12)} className="flex">
      <Link
        href={presetHref(preset)}
        aria-label={t("tryNamed", { name })}
        className={cn(
          "group flex w-full flex-col overflow-hidden rounded-lg border border-border bg-surface",
          "transition-[border-color,transform] duration-[120ms] ease-panel hover:-translate-y-0.5 hover:border-accent",
        )}
      >
        <div className="relative flex aspect-[8/5] items-center justify-center bg-surface-2">
          <PresetMinimap scenarioId={preset.scenarioId} color={color} className="size-full p-1" />
          <span className="absolute top-2 left-2 inline-flex h-6 items-center gap-1 rounded-full bg-surface px-2 text-micro font-medium text-foreground shadow-xs">
            <TargetIcon size={12} strokeWidth={1.75} aria-hidden="true" />
            {t(`targets.${preset.target}`)}
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-3 p-4">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold">{name}</h3>
            <p className="text-small text-muted">{t(`items.${preset.id}.blurb`)}</p>
          </div>
          {chips}
          <span className="mt-auto flex items-center gap-1 pt-1 text-small font-medium text-accent">
            {t("try")}
            <ArrowRight
              size={14}
              strokeWidth={1.75}
              aria-hidden="true"
              className="transition-transform duration-[120ms] group-hover:translate-x-1"
            />
          </span>
        </div>
      </Link>
    </motion.li>
  );
}
