"use client";

import { CircleAlert, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Num } from "@/components/ui/num";
import { usePlanner } from "@/stores/planner";

export function CsvErrors() {
  const t = useTranslations("planner.stops.csvErrors");
  const errors = usePlanner((state) => state.csvErrors);
  const clear = usePlanner((state) => state.setCsvErrors);
  if (errors.length === 0) return null;

  return (
    <section
      role="alert"
      aria-label={t("title")}
      className="flex flex-col gap-2 rounded-lg border border-danger bg-surface p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <CircleAlert
            size={16}
            strokeWidth={1.75}
            className="mt-0.5 shrink-0 text-danger"
            aria-hidden="true"
          />
          <div className="flex flex-col">
            <h3 className="text-sm font-semibold text-danger">{t("title")}</h3>
            <p className="text-small text-muted">{t("summary", { count: errors.length })}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label={t("dismiss")} onClick={() => clear([])}>
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </Button>
      </div>
      <ul className="flex max-h-40 flex-col overflow-y-auto border-t border-border">
        {errors.map((error, index) => (
          <li
            key={`${error.row}-${index}`}
            className="flex gap-3 border-b border-border py-1.5 text-small last:border-b-0"
          >
            <span className="shrink-0 text-muted">
              {t("row")} <Num>{error.row}</Num>
            </span>
            <span className="min-w-0">{error.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
