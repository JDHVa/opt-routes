"use client";

import { useTranslations } from "next-intl";
import { stageLabel } from "@/lib/planner/stage";
import { usePlanner } from "@/stores/planner";

export function useStageLabel(): string | null {
  const t = useTranslations("planner.live.stages");
  const stage = usePlanner((state) => state.progress?.stage ?? null);
  const init = usePlanner((state) => {
    const value = state.paramValues.init;
    return typeof value === "string" ? value : null;
  });
  const label = stageLabel(stage, init);
  if (!label) return null;
  if (label.key === "seeding") {
    return label.init && t.has(`seedingInit.${label.init}`)
      ? t(`seedingInit.${label.init}`)
      : t("seeding");
  }
  return t(label.key);
}
