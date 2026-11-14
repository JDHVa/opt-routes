"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { MapView } from "@/components/map/RouteMap";
import { RouteMapLoader } from "@/components/map/RouteMapLoader";
import { Switch } from "@/components/ui/switch";
import type { Problem } from "@/lib/api/types";
import type { RunState } from "@/lib/compare/table";
import { EMPTY_FOCUS } from "@/lib/map/geojson";
import { algorithmDisplayName } from "@/lib/planner/algorithms";

const PADDING = { top: 16, right: 16, bottom: 16, left: 16 };

export function MiniMaps({ problem, runs }: { problem: Problem; runs: RunState[] }) {
  const t = useTranslations("compare.minimaps");
  const [sync, setSync] = useState(true);
  const [view, setView] = useState<MapView | null>(null);
  const shown = runs.filter((run) => run.liveSolution !== null);

  return (
    <div className="flex flex-col gap-3">
      <label className="flex w-fit items-center gap-2 text-small">
        <Switch checked={sync} onCheckedChange={setSync} />
        {t("sync")}
      </label>
      {shown.length === 0 ? (
        <p className="text-small text-muted">{t("empty")}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((run) => (
            <li
              key={run.index}
              className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface"
            >
              <h3 className="border-b border-border px-3 py-2 text-small font-medium">
                {algorithmDisplayName(run.algorithm)}
              </h3>
              <RouteMapLoader
                className="h-56 w-full"
                problem={problem}
                solution={run.liveSolution}
                focus={EMPTY_FOCUS}
                padding={PADDING}
                fitNonce={1}
                drawNonce={0}
                interactive={false}
                panZoom
                showNavigation={false}
                compactAttribution
                view={sync ? view : null}
                onViewChange={sync ? setView : undefined}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
