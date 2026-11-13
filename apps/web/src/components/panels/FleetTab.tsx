"use client";

import { Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Num } from "@/components/ui/num";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { Locale } from "@/i18n/routing";
import { formatClock, formatKg, formatMinutes, formatNumber } from "@/lib/format";
import { routeColor } from "@/lib/routes/palette";
import { usePlanner } from "@/stores/planner";
import { Field } from "./Field";

export function FleetTab() {
  const t = useTranslations("planner.fleet");
  const locale = useLocale() as Locale;
  const problem = usePlanner((state) => state.problem);
  const vehicles = usePlanner((state) => state.vehicles);
  const catalogStatus = usePlanner((state) => state.catalogStatus);
  const updateDriver = usePlanner((state) => state.updateDriver);
  const addDriver = usePlanner((state) => state.addDriver);
  const removeDriver = usePlanner((state) => state.removeDriver);

  if (!problem) return <p className="text-muted">{t("noProblem")}</p>;
  if (catalogStatus === "loading" || catalogStatus === "idle") {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const catalog =
    vehicles.length > 0 ? vehicles : problem.vehicle_types;
  const items = catalog.map((vehicle) => ({
    value: vehicle.id,
    label: `${vehicle.brand} ${vehicle.name}`,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">
          <Num>{problem.drivers.length}</Num> {t("count", { count: problem.drivers.length })}
        </h3>
      </div>
      <ul className="flex flex-col gap-4">
        {problem.drivers.map((driver, index) => {
          const vehicle = catalog.find((v) => v.id === driver.vehicle_type_id);
          const name = driver.name ?? t("driverName", { n: index + 1 });
          const shiftEnd = driver.shift_start_min + driver.max_shift_min;
          return (
            <li
              key={driver.id}
              className="flex flex-col gap-3 rounded-lg border border-border p-3"
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: routeColor(index) }}
                />
                <span className="num text-small text-muted">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("remove", { name })}
                  disabled={problem.drivers.length <= 1}
                  onClick={() => removeDriver(index)}
                >
                  <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
                </Button>
              </div>
              <Field label={t("vehicle")} htmlFor={`vehicle-${driver.id}`}>
                <Select
                  items={items}
                  value={driver.vehicle_type_id}
                  onValueChange={(next) => {
                    if (typeof next === "string") updateDriver(index, { vehicle_type_id: next });
                  }}
                >
                  <SelectTrigger id={`vehicle-${driver.id}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {catalog.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        <span className="flex items-center gap-2">
                          {option.brand} {option.name}
                          {option.approx ? (
                            <span className="rounded-sm bg-surface-2 px-1.5 text-micro text-muted">
                              {t("approx")}
                            </span>
                          ) : null}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {vehicle ? (
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-muted">
                  <Num>{formatKg(vehicle.payload_kg, locale)}</Num>
                  <Num>{formatNumber(vehicle.volume_m3, locale, 1)} m³</Num>
                  {vehicle.approx ? (
                    <span className="rounded-sm bg-surface-2 px-1.5">{t("approx")}</span>
                  ) : null}
                </p>
              ) : null}
              {problem.mode === "multi_origin" ? (
                <p className="text-small">
                  <span className="text-muted">{t("start")}: </span>
                  {driver.start?.address ?? t("startDepot")}
                </p>
              ) : null}
              <p className="text-small">
                <span className="text-muted">{t("shift")}: </span>
                <Num>
                  {formatClock(driver.shift_start_min)}–{formatClock(shiftEnd)}
                </Num>{" "}
                <span className="text-muted">
                  (<Num>{formatMinutes(driver.max_shift_min, locale)}</Num>)
                </span>
              </p>
            </li>
          );
        })}
      </ul>
      <Button variant="outline" onClick={addDriver}>
        <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
        {t("addDriver")}
      </Button>
    </div>
  );
}
