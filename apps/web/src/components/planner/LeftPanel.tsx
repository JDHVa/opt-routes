"use client";

import { Loader2, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParamValidation } from "@/components/panels/AlgorithmTab";
import { AlgorithmTab } from "@/components/panels/AlgorithmTab";
import { ConstraintsTab } from "@/components/panels/ConstraintsTab";
import { FleetTab } from "@/components/panels/FleetTab";
import { StopsTab } from "@/components/panels/StopsTab";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePlanner, type LeftTab } from "@/stores/planner";
import { useReducedMotion } from "@/lib/motion/use-reduced-motion";
import { useRunFraction } from "./use-run-fraction";
import { useStageLabel } from "./use-stage-label";

const TABS: LeftTab[] = ["stops", "fleet", "constraints", "algorithm"];

export function LeftPanel() {
  const t = useTranslations("planner");
  const leftTab = usePlanner((state) => state.leftTab);
  const setLeftTab = usePlanner((state) => state.setLeftTab);
  const hasStops = usePlanner((state) => (state.problem?.stops.length ?? 0) > 0);
  const status = usePlanner((state) => state.status);
  const optimize = usePlanner((state) => state.optimize);
  const { ok: paramsOk } = useParamValidation();
  const stageText = useStageLabel();
  const busy = status === "loading" || status === "running";
  const fraction = useRunFraction();
  const reduced = useReducedMotion();
  const tabEnter = reduced
    ? "animate-in fade-in-0 duration-100"
    : "animate-in fade-in-0 slide-in-from-bottom-1 duration-[200ms] ease-panel";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Tabs
        value={leftTab}
        onValueChange={(value) => setLeftTab(value as LeftTab)}
        className="min-h-0 flex-1 gap-0"
      >
        <div className="border-b border-border p-2">
          <TabsList className="flex h-8 w-full">
            {TABS.map((tab) => (
              <TabsTrigger key={tab} value={tab} data-coach={tab} className="flex-auto px-2 text-small">
                {t(`tabs.${tab}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <TabsContent value="stops" className={tabEnter}>
            <StopsTab />
          </TabsContent>
          <TabsContent value="fleet" className={tabEnter}>
            <FleetTab />
          </TabsContent>
          <TabsContent value="constraints" className={tabEnter}>
            <ConstraintsTab />
          </TabsContent>
          <TabsContent value="algorithm" className={tabEnter}>
            <AlgorithmTab />
          </TabsContent>
        </div>
      </Tabs>
      <div className="border-t border-border p-4">
        <Button
          size="lg"
          data-coach="optimize"
          className="relative w-full overflow-hidden"
          disabled={!hasStops || !paramsOk}
          aria-busy={busy}
          onClick={() => {
            if (!busy) void optimize();
          }}
        >
          {busy ? (
            <span
              aria-hidden="true"
              data-testid="optimize-progress"
              className="absolute inset-y-0 left-0 w-full origin-left bg-accent-fg/25 transition-transform duration-[200ms] ease-linear"
              style={{ transform: `scaleX(${fraction})` }}
            />
          ) : null}
          {busy ? (
            <Loader2 size={16} strokeWidth={1.75} className="animate-spin" aria-hidden="true" />
          ) : (
            <Play size={16} strokeWidth={1.75} aria-hidden="true" />
          )}
          <span className="relative truncate">{busy ? (stageText ?? t("optimizing")) : t("optimize")}</span>
        </Button>
      </div>
    </div>
  );
}
