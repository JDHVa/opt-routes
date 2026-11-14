"use client";

import { CircleCheck, CircleAlert, PackageCheck, PackagePlus, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { formatClock, formatSeconds } from "@/lib/format";
import type { SimEvent } from "@/lib/sim/reducer";

const MAX_LISTED_IDS = 3;

function EventIcon({ kind }: { kind: SimEvent["kind"] }) {
  const props = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
  switch (kind) {
    case "reopt":
      return <RefreshCw {...props} className="text-warning" />;
    case "order":
      return <PackagePlus {...props} className="text-accent" />;
    case "delivered":
      return <PackageCheck {...props} className="text-success" />;
    case "done":
      return <CircleCheck {...props} className="text-success" />;
    case "error":
      return <CircleAlert {...props} className="text-danger" />;
  }
}

function EventText({ event }: { event: SimEvent }) {
  const t = useTranslations("simulate.log");
  const locale = useLocale() as Locale;
  switch (event.kind) {
    case "reopt":
      return (
        <>
          {t(`reopt.${event.reason}`)}
          <span className="block text-micro text-muted">
            {t("reoptDetail", {
              runtime: formatSeconds(event.runtimeS, locale),
              count: event.remaining,
            })}
          </span>
        </>
      );
    case "order":
      return t("order", { id: event.stopId });
    case "delivered": {
      const listed = event.stopIds.slice(0, MAX_LISTED_IDS).join(", ");
      const extra = event.stopIds.length - MAX_LISTED_IDS;
      return t("delivered", { ids: extra > 0 ? `${listed} +${extra}` : listed });
    }
    case "done":
      return t("done");
    case "error":
      return t("error", { code: event.code });
  }
}

export function EventLog({ events }: { events: SimEvent[] }) {
  const t = useTranslations("simulate.log");
  const ordered = [...events].reverse();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border p-4">
        <h2 className="text-h2 font-semibold">{t("title")}</h2>
      </div>
      {ordered.length === 0 ? (
        <p className="p-4 text-small text-muted">{t("empty")}</p>
      ) : (
        <ol
          role="log"
          aria-label={t("title")}
          className="min-h-0 flex-1 overflow-y-auto"
          data-testid="sim-log"
        >
          {ordered.map((event) => (
            <li
              key={event.id}
              className="grid grid-cols-[auto_auto_1fr] items-start gap-2 border-b border-border px-4 py-2 text-small last:border-b-0"
            >
              <span className="num mt-px text-muted">{formatClock(event.clock)}</span>
              <span className="mt-0.5">
                <EventIcon kind={event.kind} />
              </span>
              <span className="min-w-0 break-words">
                <EventText event={event} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
