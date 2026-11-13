"use client";

import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";
import type { ConstraintToggles, ProblemMode } from "@/lib/api/types";
import { usePlanner } from "@/stores/planner";
import { PanelHeading } from "./Field";
import { Segmented } from "./Segmented";

const TOGGLES: (keyof ConstraintToggles)[] = [
  "capacity_kg",
  "capacity_m3",
  "time_windows",
  "max_shift",
  "priorities",
];

const MODES: ProblemMode[] = ["depot", "multi_origin"];

export function ConstraintsTab() {
  const t = useTranslations("planner.constraints");
  const problem = usePlanner((state) => state.problem);
  const setMode = usePlanner((state) => state.setMode);
  const toggleConstraint = usePlanner((state) => state.toggleConstraint);

  if (!problem) {
    return <p className="text-muted">{t("noProblem")}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <PanelHeading>{t("mode")}</PanelHeading>
        <Segmented
          ariaLabel={t("mode")}
          value={problem.mode}
          onChange={setMode}
          options={MODES.map((mode) => ({ value: mode, label: t(`modes.${mode}`) }))}
        />
        <p className="text-micro text-muted">{t(`modeHelp.${problem.mode}`)}</p>
      </section>

      <section className="flex flex-col gap-3">
        <PanelHeading>{t("title")}</PanelHeading>
        <ul className="flex flex-col divide-y divide-border">
          {TOGGLES.map((key) => (
            <li key={key}>
              <label className="flex cursor-pointer items-start justify-between gap-4 py-3">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm">{t(`toggles.${key}.label`)}</span>
                  <span className="text-micro text-muted">{t(`toggles.${key}.help`)}</span>
                </span>
                <Switch
                  checked={problem.constraints[key]}
                  onCheckedChange={(next) => toggleConstraint(key, next)}
                  className="mt-0.5"
                />
              </label>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
