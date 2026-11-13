import { INTL_LOCALE, type Locale } from "@/i18n/routing";

export const DAY_START_MINUTES = 8 * 60;

function intl(locale: Locale): string {
  return INTL_LOCALE[locale];
}

export function formatNumber(
  value: number,
  locale: Locale,
  fractionDigits = 0,
): string {
  return new Intl.NumberFormat(intl(locale), {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatKm(km: number, locale: Locale, fractionDigits = 1): string {
  return new Intl.NumberFormat(intl(locale), {
    style: "unit",
    unit: "kilometer",
    unitDisplay: "short",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(km);
}

export function formatMXN(amount: number, locale: Locale): string {
  return new Intl.NumberFormat(intl(locale), {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatKg(kg: number, locale: Locale): string {
  return new Intl.NumberFormat(intl(locale), {
    style: "unit",
    unit: "kilogram",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(kg);
}

export function formatMinutes(minutes: number, locale: Locale): string {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  const unit = (value: number, name: "hour" | "minute") =>
    new Intl.NumberFormat(intl(locale), {
      style: "unit",
      unit: name,
      unitDisplay: "short",
    }).format(value);
  if (hours === 0) return unit(rest, "minute");
  if (rest === 0) return unit(hours, "hour");
  return `${unit(hours, "hour")} ${unit(rest, "minute")}`;
}

export function formatClock(
  minutesSinceStart: number,
  dayStartMinutes = DAY_START_MINUTES,
): string {
  const total = Math.round(dayStartMinutes + minutesSinceStart);
  const wrapped = ((total % 1440) + 1440) % 1440;
  const hh = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const mm = String(wrapped % 60).padStart(2, "0");
  const dayOffset = Math.floor(total / 1440);
  return dayOffset > 0 ? `${hh}:${mm}+${dayOffset}` : `${hh}:${mm}`;
}

export function formatSeconds(seconds: number, locale: Locale): string {
  return new Intl.NumberFormat(intl(locale), {
    style: "unit",
    unit: "second",
    unitDisplay: "narrow",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(seconds);
}

export function formatFitness(value: number, locale: Locale): string {
  return formatNumber(value, locale, 4);
}

export function formatPercent(fraction: number, locale: Locale): string {
  return new Intl.NumberFormat(intl(locale), {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(fraction);
}

export type ValuePart = { value: string; unit: string };

function valueWithUnit(
  amount: number,
  locale: Locale,
  unit: "hour" | "minute" | "kilometer",
  fractionDigits: number,
): ValuePart {
  const parts = new Intl.NumberFormat(intl(locale), {
    style: "unit",
    unit,
    unitDisplay: "short",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).formatToParts(amount);
  return {
    value: parts
      .filter((part) => part.type !== "unit" && part.type !== "literal")
      .map((part) => part.value)
      .join(""),
    unit: parts
      .filter((part) => part.type === "unit")
      .map((part) => part.value)
      .join("")
      .trim(),
  };
}

export function durationParts(minutes: number, locale: Locale): ValuePart[] {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (hours === 0) return [valueWithUnit(rest, locale, "minute", 0)];
  if (rest === 0) return [valueWithUnit(hours, locale, "hour", 0)];
  return [valueWithUnit(hours, locale, "hour", 0), valueWithUnit(rest, locale, "minute", 0)];
}

export function kmParts(km: number, locale: Locale, fractionDigits = 1): ValuePart[] {
  return [valueWithUnit(km, locale, "kilometer", fractionDigits)];
}
