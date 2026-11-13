"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { RouteMapLoader } from "@/components/map/RouteMapLoader";
import { usePrefersReducedMotion } from "@/components/map/use-map-colors";
import { Num } from "@/components/ui/num";
import type { Locale } from "@/i18n/routing";
import { formatKm, formatMinutes, formatMXN } from "@/lib/format";
import { demoProblem, demoSolution } from "@/lib/landing-data";
import type { MapFocus } from "@/lib/map/geojson";

const REVEAL_INTERVAL_MS = 1100;
const PADDING = { top: 32, right: 32, bottom: 32, left: 32 };
const NO_FOCUS: MapFocus = { selectedRoute: null, hoveredRoute: null, selectedStopId: null };

export function LandingMap() {
  const t = useTranslations("landing.map");
  const locale = useLocale() as Locale;
  const reduced = usePrefersReducedMotion();
  const total = demoSolution.routes.length;
  const [progress, setProgress] = useState(0);
  const revealed = reduced ? total : progress;

  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(() => {
      setProgress((count) => {
        if (count >= total) {
          clearInterval(timer);
          return count;
        }
        return count + 1;
      });
    }, REVEAL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [reduced, total]);

  const solution = useMemo(
    () => ({
      ...demoSolution,
      routes: demoSolution.routes.slice(0, Math.max(revealed, 0)),
    }),
    [revealed],
  );

  const metrics = demoSolution.metrics;

  return (
    <figure className="flex flex-col gap-3">
      <div className="h-105 overflow-hidden rounded-lg border border-border">
        <RouteMapLoader
          className="size-full"
          problem={demoProblem}
          solution={solution}
          focus={NO_FOCUS}
          padding={PADDING}
          fitNonce={0}
          interactive={false}
          showNavigation={false}
        />
      </div>
      <figcaption className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-small text-muted">
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
