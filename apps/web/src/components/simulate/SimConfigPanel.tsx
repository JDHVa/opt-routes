"use client";

import { CircleAlert, Loader2, Play, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { Field } from "@/components/panels/Field";
import { Segmented } from "@/components/panels/Segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { AlgorithmInfo, ScenarioInfo, TriggerMode } from "@/lib/api/types";
import { algorithmDisplayName } from "@/lib/planner/algorithms";
import {
  simFieldMax,
  type SimConfigForm,
  type SimFieldKey,
  type SimFormErrors,
} from "@/lib/sim/config";
import type { SimState } from "@/lib/sim/reducer";
import { SPEED_OPTIONS } from "./Timeline";

const FIELD_UNITS: Record<SimFieldKey, string> = {
  batchMinutes: "min",
  reoptTimeLimitS: "s",
  initialTimeLimitS: "s",
};

export function SimConfigPanel({
  form,
  errors,
  scenarios,
  algorithms,
  catalogReady,
  scenarioLoading,
  scenarioReady,
  connecting,
  state,
  onChange,
  onStart,
}: {
  form: SimConfigForm;
  errors: SimFormErrors;
  scenarios: ScenarioInfo[];
  algorithms: AlgorithmInfo[];
  catalogReady: boolean;
  scenarioLoading: boolean;
  scenarioReady: boolean;
  connecting: boolean;
  state: SimState;
  onChange: (patch: Partial<SimConfigForm>) => void;
  onStart: () => void;
}) {
  const t = useTranslations("simulate.config");
  const te = useTranslations("simulate.errors");
  const baseId = useId();

  if (!catalogReady) {
    return (
      <div className="flex flex-col gap-3 p-4" aria-busy="true" aria-label={t("loading")}>
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const scenarioItems = scenarios.map((s) => ({ value: s.id, label: s.name }));
  const algorithmItems = algorithms
    .filter((a) => a.name !== "nsga2")
    .map((a) => ({ value: a.name, label: algorithmDisplayName(a.name) }));
  const fields: SimFieldKey[] =
    form.trigger === "batch"
      ? ["batchMinutes", "initialTimeLimitS", "reoptTimeLimitS"]
      : ["initialTimeLimitS", "reoptTimeLimitS"];
  const failed = state.phase === "error" || state.phase === "closed";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <form
          id={`${baseId}-form`}
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onStart();
          }}
        >
          <h2 className="text-h2 font-semibold">{t("title")}</h2>

          {failed ? (
            <div role="alert" className="flex flex-col gap-2 rounded-lg border border-danger p-3">
              <div className="flex items-start gap-2">
                <CircleAlert
                  size={16}
                  strokeWidth={1.75}
                  className="mt-0.5 shrink-0 text-danger"
                  aria-hidden="true"
                />
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-semibold text-danger">{te("title")}</p>
                  <p className="text-small">
                    {te.has(`causes.${state.error?.code ?? "unknown"}`)
                      ? te(`causes.${state.error?.code ?? "unknown"}`)
                      : te("causes.unknown")}
                  </p>
                  {state.error && state.error.message !== state.error.code ? (
                    <p className="num text-micro text-muted">{state.error.message}</p>
                  ) : null}
                </div>
              </div>
              <div>
                <Button type="button" variant="outline" onClick={onStart} disabled={!scenarioReady}>
                  <RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />
                  {te("reconnect")}
                </Button>
              </div>
            </div>
          ) : null}

          <Field label={t("scenario")} htmlFor={`${baseId}-scenario`}>
            <Select
              items={scenarioItems}
              value={form.scenarioId}
              onValueChange={(next) => {
                if (typeof next === "string") onChange({ scenarioId: next });
              }}
            >
              <SelectTrigger id={`${baseId}-scenario`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {scenarioItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label={t("algorithm")} htmlFor={`${baseId}-algorithm`}>
            <Select
              items={algorithmItems}
              value={form.algorithm}
              onValueChange={(next) => {
                if (typeof next === "string") onChange({ algorithm: next });
              }}
            >
              <SelectTrigger id={`${baseId}-algorithm`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {algorithmItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label={t("trigger")} help={t(`triggerHelp.${form.trigger}`)}>
            <Segmented<TriggerMode>
              ariaLabel={t("trigger")}
              value={form.trigger}
              onChange={(trigger) => onChange({ trigger })}
              options={[
                { value: "event", label: t("triggers.event") },
                { value: "batch", label: t("triggers.batch") },
              ]}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            {fields.map((key) => {
              const id = `${baseId}-${key}`;
              const error = errors[key];
              return (
                <Field
                  key={key}
                  label={t(`fields.${key}`)}
                  htmlFor={id}
                  error={error ? te(`field.${error}`, { bound: simFieldMax(key) }) : undefined}
                >
                  <div className="relative">
                    <Input
                      id={id}
                      type="number"
                      inputMode="decimal"
                      step="any"
                      value={form[key] ?? ""}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? `${id}-error` : undefined}
                      onChange={(event) =>
                        onChange({
                          [key]: event.target.value === "" ? null : Number(event.target.value),
                        })
                      }
                      className="num pr-10"
                    />
                    <span className="num pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-micro text-muted">
                      {FIELD_UNITS[key]}
                    </span>
                  </div>
                </Field>
              );
            })}
          </div>

          <Field label={t("speed")}>
            <Segmented
              ariaLabel={t("speed")}
              value={String(form.speed)}
              onChange={(next) => onChange({ speed: Number(next) })}
              options={SPEED_OPTIONS.map((speed) => ({
                value: String(speed),
                label: t("speedValue", { speed }),
              }))}
            />
          </Field>
          <p className="text-micro text-muted">{t("speedHelp")}</p>
        </form>
      </div>
      <div className="border-t border-border p-4">
        <Button
          type="submit"
          form={`${baseId}-form`}
          size="lg"
          className="w-full"
          disabled={!scenarioReady || scenarioLoading || connecting || Object.keys(errors).length > 0}
        >
          {connecting || scenarioLoading ? (
            <Loader2 size={16} strokeWidth={1.75} className="animate-spin" aria-hidden="true" />
          ) : (
            <Play size={16} strokeWidth={1.75} aria-hidden="true" />
          )}
          {connecting ? t("connecting") : t("start")}
        </Button>
      </div>
    </div>
  );
}
