"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  GENERATE_DEFAULTS,
  toGenerateRequest,
  validateGenerate,
  type GenerateFieldKey,
  type GenerateFormValues,
} from "@/lib/planner/generate-form";
import { usePlanner } from "@/stores/planner";
import { Field } from "./Field";
import { Segmented } from "./Segmented";

const FIELDS: { key: GenerateFieldKey; unit?: string }[] = [
  { key: "nStops" },
  { key: "nDrivers" },
  { key: "timeWindowsPct", unit: "%" },
  { key: "highPriorityPct", unit: "%" },
  { key: "dynamicPct", unit: "%" },
  { key: "seed" },
];

export function GenerateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("planner.generate");
  const tm = useTranslations("planner.constraints.modes");
  const baseId = useId();
  const generate = usePlanner((state) => state.generate);
  const generating = usePlanner((state) => state.generating);
  const [values, setValues] = useState<GenerateFormValues>(GENERATE_DEFAULTS);
  const errors = useMemo(() => validateGenerate(values), [values]);
  const invalid = Object.keys(errors).length > 0;

  const submit = async () => {
    const request = toGenerateRequest(values);
    if (!request) return;
    if (await generate(request)) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            {FIELDS.map(({ key, unit }) => {
              const id = `${baseId}-${key}`;
              const error = errors[key];
              const value = values[key];
              return (
                <Field
                  key={key}
                  label={t(`fields.${key}`)}
                  htmlFor={id}
                  error={
                    error ? t(`errors.${error.code}`, { bound: error.bound ?? 0 }) : undefined
                  }
                >
                  <div className="relative">
                    <Input
                      id={id}
                      type="number"
                      inputMode="numeric"
                      value={value ?? ""}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? `${id}-error` : undefined}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          [key]: event.target.value === "" ? null : Number(event.target.value),
                        }))
                      }
                      className={unit ? "num pr-8" : "num"}
                    />
                    {unit ? (
                      <span className="num pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-micro text-muted">
                        {unit}
                      </span>
                    ) : null}
                  </div>
                </Field>
              );
            })}
          </div>
          <Field label={t("fields.mode")}>
            <Segmented
              ariaLabel={t("fields.mode")}
              value={values.mode}
              onChange={(mode) => setValues((current) => ({ ...current, mode }))}
              options={[
                { value: "depot", label: tm("depot") },
                { value: "multi_origin", label: tm("multi_origin") },
              ]}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={invalid || generating}>
              {generating ? (
                <Loader2 size={16} strokeWidth={1.75} className="animate-spin" aria-hidden="true" />
              ) : null}
              {generating ? t("generating") : t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
