"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InfoTip } from "@/components/ui/info-tip";
import { Switch } from "@/components/ui/switch";
import type {
  ParamErrorCode,
  ParamField,
  ParamValue,
} from "@/lib/planner/params-form";
import { Field } from "./Field";

const UNITS: Record<string, string> = {
  time_limit_s: "s",
};

export function ParamControl({
  field,
  value,
  error,
  onChange,
}: {
  field: ParamField;
  value: ParamValue;
  error?: { code: ParamErrorCode; bound?: number };
  onChange: (value: ParamValue) => void;
}) {
  const t = useTranslations("planner.algorithm");
  const id = useId();
  const label = t.has(`params.${field.key}`) ? t(`params.${field.key}`) : field.title;
  const help = t.has(`paramHelp.${field.key}`) ? t(`paramHelp.${field.key}`) : undefined;
  const info = (
    <InfoTip
      topic={`params.${field.key}`}
      fallback={{ title: label, body: field.description ?? field.title }}
    />
  );
  const errorText = error ? t(`errors.${error.code}`, { bound: error.bound ?? 0 }) : undefined;

  if (field.kind === "boolean") {
    return (
      <div className="flex items-center justify-between gap-3 py-1">
        <span className="flex items-center gap-0.5">
          <span className="text-small">{label}</span>
          {info}
        </span>
        <Switch aria-label={label} checked={value === true} onCheckedChange={(next) => onChange(next)} />
      </div>
    );
  }

  if (field.kind === "enum") {
    const items = field.options.map((option) => ({
      value: option,
      label: t.has(`enumValues.${option}`) ? t(`enumValues.${option}`) : option,
    }));
    return (
      <Field label={label} htmlFor={id} help={help} info={info}>
        <Select
          items={items}
          value={typeof value === "string" ? value : field.defaultValue}
          onValueChange={(next) => {
            if (typeof next === "string") onChange(next);
          }}
        >
          <SelectTrigger id={id} className="w-full">
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
    );
  }

  const unit = UNITS[field.key];
  return (
    <Field label={label} htmlFor={id} help={help} error={errorText} info={info}>
      <div className="relative">
        <Input
          id={id}
          type="number"
          inputMode={field.kind === "integer" ? "numeric" : "decimal"}
          step={field.kind === "integer" ? 1 : "any"}
          value={typeof value === "number" ? value : ""}
          placeholder={field.nullable ? t("auto") : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => {
            const raw = event.target.value;
            onChange(raw === "" ? null : Number(raw));
          }}
          className={unit ? "num pr-8" : "num"}
        />
        {unit ? (
          <span className="num pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-micro text-faint">
            {unit}
          </span>
        ) : null}
      </div>
    </Field>
  );
}
