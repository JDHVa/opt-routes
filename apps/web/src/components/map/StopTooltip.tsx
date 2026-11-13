"use client";

import { Clock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { formatClock, formatKg, formatMinutes } from "@/lib/format";
import type { StopDetail } from "@/lib/map/geojson";
import { routeColor } from "@/lib/routes/palette";

export function StopTooltip({ detail }: { detail: StopDetail }) {
  const t = useTranslations("map.tooltip");
  const locale = useLocale() as Locale;
  const hasWindow = detail.twStart !== null || detail.twEnd !== null;

  return (
    <div className="flex min-w-48 flex-col gap-1">
      <div className="flex items-center gap-2">
        {detail.driverIndex !== null ? (
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: routeColor(detail.driverIndex) }}
          />
        ) : null}
        <span className="num font-medium">{detail.stopId}</span>
        {detail.visitOrder !== null && detail.driverIndex !== null ? (
          <span className="text-muted">
            {t("visit", { driver: detail.driverIndex + 1, order: detail.visitOrder })}
          </span>
        ) : (
          <span className="text-muted">{t("unassigned")}</span>
        )}
      </div>
      {detail.address ? (
        <p className="text-small text-muted">{detail.address}</p>
      ) : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-small">
        {detail.arrival !== null ? (
          <>
            <dt className="text-muted">{t("eta")}</dt>
            <dd className="num text-right">{formatClock(detail.arrival)}</dd>
          </>
        ) : null}
        {detail.late !== null && detail.late > 0 ? (
          <>
            <dt className="text-warning">{t("late")}</dt>
            <dd className="num text-right text-warning">
              {formatMinutes(detail.late, locale)}
            </dd>
          </>
        ) : null}
        {hasWindow ? (
          <>
            <dt className="flex items-center gap-1 text-muted">
              <Clock size={12} strokeWidth={1.75} aria-hidden="true" />
              {t("window")}
            </dt>
            <dd className="num text-right">
              {formatClock(detail.twStart ?? 0)}–{detail.twEnd !== null ? formatClock(detail.twEnd) : ""}
            </dd>
          </>
        ) : null}
        <dt className="text-muted">{t("load")}</dt>
        <dd className="num text-right">{formatKg(detail.demandKg, locale)}</dd>
        <dt className="text-muted">{t("priority")}</dt>
        <dd className="text-right">{t(`priorities.${detail.priority}`)}</dd>
      </dl>
    </div>
  );
}
