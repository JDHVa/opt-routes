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

const TABS: LeftTab[] = ["stops", "fleet", "constraints", "algorithm"];

export function LeftPanel() {
  const t = useTranslations("planner");
  const leftTab = usePlanner((state) => state.leftTab);
  const setLeftTab = usePlanner((state) => state.setLeftTab);
  const hasStops = usePlanner((state) => (state.problem?.stops.length ?? 0) > 0);
  const status = usePlanner((state) => state.status);
  const optimize = usePlanner((state) => state.optimize);
  const { ok: paramsOk } = useParamValidation();
  const busy = status === "loading" || status === "running";

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
              <TabsTrigger key={tab} value={tab} className="flex-auto px-2 text-small">
                {t(`tabs.${tab}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <TabsContent value="stops">
            <StopsTab />
          </TabsContent>
          <TabsContent value="fleet">
            <FleetTab />
          </TabsContent>
          <TabsContent value="constraints">
            <ConstraintsTab />
          </TabsContent>
          <TabsContent value="algorithm">
            <AlgorithmTab />
          </TabsContent>
        </div>
      </Tabs>
      <div className="border-t border-border p-4">
        <Button
          size="lg"
          className="w-full"
          disabled={!hasStops || busy || !paramsOk}
          onClick={() => void optimize()}
        >
          {busy ? (
            <Loader2 size={16} strokeWidth={1.75} className="animate-spin" aria-hidden="true" />
          ) : (
            <Play size={16} strokeWidth={1.75} aria-hidden="true" />
          )}
          {busy ? t("optimizing") : t("optimize")}
        </Button>
      </div>
    </div>
  );
}
