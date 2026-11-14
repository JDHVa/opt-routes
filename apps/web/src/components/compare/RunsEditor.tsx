"use client";

import { ChevronDown, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useMemo } from "react";
import { Field } from "@/components/panels/Field";
import { ParamControl } from "@/components/panels/ParamControl";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AlgorithmInfo } from "@/lib/api/types";
import { algorithmDisplayName } from "@/lib/planner/algorithms";
import { buildParamFields, validateParams } from "@/lib/planner/params-form";
import { algorithmSeriesStyle } from "@/lib/routes/palette";
import {
  MAX_RUNS,
  MIN_RUNS,
  useCompare,
  type RunConfig,
} from "@/stores/compare";

const COMPARABLE = new Set(["ga", "aco", "aco_ga", "pyvrp", "ortools"]);

function RunRow({
  run,
  position,
  algorithms,
  disabled,
  removable,
}: {
  run: RunConfig;
  position: number;
  algorithms: AlgorithmInfo[];
  disabled: boolean;
  removable: boolean;
}) {
  const t = useTranslations("compare.runs");
  const tp = useTranslations("planner.algorithm");
  const algorithmId = useId();
  const limitId = useId();
  const setRunAlgorithm = useCompare((state) => state.setRunAlgorithm);
  const setRunParam = useCompare((state) => state.setRunParam);
  const removeRun = useCompare((state) => state.removeRun);

  const info = algorithms.find((a) => a.name === run.algorithm);
  const fields = useMemo(() => (info ? buildParamFields(info.params_schema) : []), [info]);
  const { errors } = useMemo(() => validateParams(fields, run.params), [fields, run.params]);
  const advanced = fields.filter((field) => field.key !== "time_limit_s");
  const hasLimit = fields.some((field) => field.key === "time_limit_s");
  const limitValue = run.params.time_limit_s;
  const limitError = errors.time_limit_s;
  const style = algorithmSeriesStyle(run.algorithm, position);
  const items = algorithms
    .filter((a) => COMPARABLE.has(a.name))
    .map((a) => ({ value: a.name, label: algorithmDisplayName(a.name) }));

  return (
    <li className="flex flex-col gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <div className="grid grid-cols-[auto_1fr_auto] items-end gap-3 sm:grid-cols-[auto_minmax(0,1fr)_8rem_auto]">
        <span
          aria-hidden="true"
          className="mb-2.5 h-1 w-5 rounded-full"
          style={
            style.dashed
              ? {
                  backgroundImage: `repeating-linear-gradient(90deg, ${style.color} 0 6px, transparent 6px 9px)`,
                }
              : { backgroundColor: style.color }
          }
        />
        <Field label={t("algorithm", { n: position + 1 })} htmlFor={algorithmId}>
          <Select
            items={items}
            value={run.algorithm}
            disabled={disabled}
            onValueChange={(next) => {
              if (typeof next === "string") setRunAlgorithm(run.id, algorithms, next);
            }}
          >
            <SelectTrigger id={algorithmId} className="w-full">
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
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled || !removable}
          aria-label={t("remove", { n: position + 1 })}
          onClick={() => removeRun(run.id)}
          className="sm:col-start-4 sm:row-start-1"
        >
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </Button>
        {hasLimit ? (
          <Field
            label={tp("params.time_limit_s")}
            htmlFor={limitId}
            error={
              limitError ? tp(`errors.${limitError.code}`, { bound: limitError.bound ?? 0 }) : undefined
            }
            className="col-span-3 sm:col-span-1 sm:col-start-3 sm:row-start-1"
          >
            <div className="relative">
              <Input
                id={limitId}
                type="number"
                inputMode="decimal"
                step="any"
                disabled={disabled}
                value={typeof limitValue === "number" ? limitValue : ""}
                aria-invalid={limitError ? true : undefined}
                aria-describedby={limitError ? `${limitId}-error` : undefined}
                onChange={(event) =>
                  setRunParam(
                    run.id,
                    "time_limit_s",
                    event.target.value === "" ? null : Number(event.target.value),
                  )
                }
                className="num pr-8"
              />
              <span className="num pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-micro text-muted">
                s
              </span>
            </div>
          </Field>
        ) : null}
      </div>
      {advanced.length > 0 ? (
        <Collapsible>
          <CollapsibleTrigger className="group flex h-6 items-center gap-1 rounded-md text-small text-muted hover:text-foreground">
            {tp("advanced")}
            <ChevronDown
              size={16}
              strokeWidth={1.75}
              aria-hidden="true"
              className="transition-transform duration-[160ms] group-data-[panel-open]:rotate-180"
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="grid grid-cols-2 gap-3 pt-3 sm:grid-cols-3">
            {advanced.map((field) => (
              <ParamControl
                key={field.key}
                field={field}
                value={run.params[field.key] ?? null}
                error={errors[field.key]}
                onChange={(value) => setRunParam(run.id, field.key, value)}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </li>
  );
}

export function RunsEditor({
  algorithms,
  disabled,
}: {
  algorithms: AlgorithmInfo[];
  disabled: boolean;
}) {
  const t = useTranslations("compare.runs");
  const runs = useCompare((state) => state.runs);
  const addRun = useCompare((state) => state.addRun);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-3 pb-2">
        <h2 className="text-h2 font-semibold">{t("title")}</h2>
        <Button
          variant="outline"
          disabled={disabled || runs.length >= MAX_RUNS}
          onClick={() => addRun(algorithms)}
        >
          <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
          {t("add")}
        </Button>
      </div>
      <ul className="rounded-lg border border-border bg-surface">
        {runs.map((run, index) => (
          <RunRow
            key={run.id}
            run={run}
            position={index}
            algorithms={algorithms}
            disabled={disabled}
            removable={runs.length > MIN_RUNS}
          />
        ))}
      </ul>
      <p className="pt-2 text-micro text-muted">{t("limits", { min: MIN_RUNS, max: MAX_RUNS })}</p>
    </div>
  );
}
