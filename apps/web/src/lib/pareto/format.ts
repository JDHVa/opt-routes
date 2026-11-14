import type { Locale } from "@/i18n/routing";
import { formatMinutes, formatMXN, formatNumber } from "@/lib/format";
import type { ObjectiveKey } from "./front";

export const OBJECTIVE_UNITS: Record<ObjectiveKey, string> = {
  time: "min",
  cost: "MXN",
  vehicles: "",
  makespan: "min",
};

export function formatObjective(key: ObjectiveKey, value: number, locale: Locale): string {
  switch (key) {
    case "time":
    case "makespan":
      return formatMinutes(value, locale);
    case "cost":
      return formatMXN(value, locale);
    case "vehicles":
      return formatNumber(value, locale);
  }
}

export function formatAxisTick(value: number, locale: Locale): string {
  return formatNumber(value, locale);
}
