"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useMemo } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ObjectiveWeights } from "@/lib/api/types";
import { algorithmDisplayName } from "@/lib/planner/algorithms";
import {
  buildParamFields,
  splitFields,
  validateParams,
} from "@/lib/planner/params-form";
import { detectPreset, PRESET_IDS, type PresetId } from "@/lib/planner/presets";
import { usePlanner } from "@/stores/planner";
import { Field, PanelHeading } from "./Field";
import { ParamControl } from "./ParamControl";
import { Segmented } from "./Segmented";

const WEIGHT_KEYS: (keyof ObjectiveWeights)[] = ["time", "cost", "vehicles", "makespan"];

export function useParamValidation() {
  const algorithms = usePlanner((state) => state.algorithms);
  const algorithm = usePlanner((state) => state.algorithm);
  const paramValues = usePlanner((state) => state.paramValues);
  return useMemo(() => {
    const info = algorithms.find((a) => a.name === algorithm);
    const fields = info ? buildParamFields(info.params_schema) : [];
    return { fields, ...validateParams(fields, paramValues) };
  }, [algorithms, algorithm, paramValues]);
}

export function AlgorithmTab() {
  const t = useTranslations("planner.algorithm");
  const tp = useTranslations("planner.presets");
  const selectId = useId();
  const algorithms = usePlanner((state) => state.algorithms);
  const catalogStatus = usePlanner((state) => state.catalogStatus);
  const algorithm = usePlanner((state) => state.algorithm);
  const paramValues = usePlanner((state) => state.paramValues);
  const weights = usePlanner((state) => state.problem?.objective.weights ?? null);
  const setAlgorithm = usePlanner((state) => state.setAlgorithm);
  const setParam = usePlanner((state) => state.setParam);
  const applyPreset = usePlanner((state) => state.applyPreset);
  const setWeight = usePlanner((state) => state.setWeight);
  const { fields, errors } = useParamValidation();
  const { key, advanced } = useMemo(() => splitFields(algorithm, fields), [algorithm, fields]);

  if (catalogStatus === "loading" || catalogStatus === "idle") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const items = algorithms.map((a) => ({
    value: a.name,
    label: algorithmDisplayName(a.name),
  }));
  const current = algorithms.find((a) => a.name === algorithm);
  const preset: PresetId | null = weights ? detectPreset(weights) : null;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <PanelHeading>{t("algorithm")}</PanelHeading>
        <Field label={t("algorithmLabel")} htmlFor={selectId} help={current?.label}>
          <Select
            items={items}
            value={algorithm}
            onValueChange={(next) => {
              if (typeof next === "string") setAlgorithm(next);
            }}
          >
            <SelectTrigger id={selectId} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </section>

      <section className="flex flex-col gap-3">
        <PanelHeading>{t("objective")}</PanelHeading>
        <Segmented
          ariaLabel={t("objective")}
          value={preset}
          onChange={applyPreset}
          columns={2}
          spacing={1}
          options={PRESET_IDS.map((id) => ({ value: id, label: tp(id) }))}
        />
        <p className="text-micro text-muted">
          {preset ? tp(`${preset}Help`) : tp("customHelp")}
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <PanelHeading>{t("parameters")}</PanelHeading>
        <div className="grid grid-cols-2 gap-3">
          {key.map((field) => (
            <ParamControl
              key={field.key}
              field={field}
              value={paramValues[field.key] ?? null}
              error={errors[field.key]}
              onChange={(value) => setParam(field.key, value)}
            />
          ))}
        </div>
      </section>

      <Collapsible>
        <CollapsibleTrigger className="group flex h-8 w-full items-center justify-between rounded-md text-sm font-semibold text-foreground">
          {t("advanced")}
          <ChevronDown
            size={16}
            strokeWidth={1.75}
            aria-hidden="true"
            className="transition-transform duration-[160ms] group-data-[panel-open]:rotate-180"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-6 pt-3">
          {weights ? (
            <div className="flex flex-col gap-3">
              <h4 className="text-small font-medium">{t("weights")}</h4>
              <div className="grid grid-cols-2 gap-3">
                {WEIGHT_KEYS.map((name) => (
                  <Field key={name} label={t(`weightLabels.${name}`)} htmlFor={`${selectId}-${name}`}>
                    <Input
                      id={`${selectId}-${name}`}
                      type="number"
                      min={0}
                      step={0.05}
                      value={weights[name]}
                      onChange={(event) => setWeight(name, Math.max(0, Number(event.target.value)))}
                      className="num"
                    />
                  </Field>
                ))}
              </div>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            {advanced.map((field) => (
              <ParamControl
                key={field.key}
                field={field}
                value={paramValues[field.key] ?? null}
                error={errors[field.key]}
                onChange={(value) => setParam(field.key, value)}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
