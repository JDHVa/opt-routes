"use client";

import { useLocale, useTranslations } from "next-intl";
import { RouteMapLoader } from "@/components/map/RouteMapLoader";
import { Num } from "@/components/ui/num";
import type { Locale } from "@/i18n/routing";
import { formatKm, formatMinutes, formatMXN } from "@/lib/format";
import { demoProblem, demoSolution } from "@/lib/landing-data";
import type { MapFocus } from "@/lib/map/geojson";

const PADDING = { top: 32, right: 32, bottom: 32, left: 32 };
const NO_FOCUS: MapFocus = { selectedRoute: null, hoveredRoute: null, selectedStopId: null };

export function LandingMap() {
  const t = useTranslations("landing.map");
  const th = useTranslations("landing.heroMap");
  const locale = useLocale() as Locale;
  const metrics = demoSolution.metrics;

  return (
    <figure className="flex flex-col gap-3">
      <div className="relative h-80 overflow-hidden rounded-lg border border-border md:h-[26rem]">
        <RouteMapLoader
          className="size-full"
          problem={demoProblem}
          solution={demoSolution}
          focus={NO_FOCUS}
          padding={PADDING}
          fitNonce={0}
          drawNonce={0}
          ants
          interactive={false}
          showNavigation={false}
        />
        <p className="pointer-events-none absolute top-3 left-3 flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-micro text-muted shadow-xs">
          <span aria-hidden="true" className="size-2 rounded-full bg-signal" />
          {th("legend")}
        </p>
      </div>
      <figcaption className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-small text-muted">
        <span>{t("caption", { name: demoProblem.name })}</span>
        <span>
          <Num className="text-foreground">{demoProblem.stops.length}</Num> {t("stops")}
        </span>
        <span>
          <Num className="text-foreground">{metrics.vehicles_used}</Num> {t("vehicles")}
        </span>
        <span>
          <Num className="text-foreground">{formatKm(metrics.total_distance_km, locale)}</Num>
        </span>
        <span>
          <Num className="text-foreground">{formatMinutes(metrics.makespan_min, locale)}</Num>{" "}
          {t("makespan")}
        </span>
        <span>
          <Num className="text-foreground">{formatMXN(metrics.total_cost_mxn, locale)}</Num>
        </span>
      </figcaption>
    </figure>
  );
}
