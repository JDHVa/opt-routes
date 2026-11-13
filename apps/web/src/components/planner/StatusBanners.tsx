"use client";

import { CircleAlert, TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Num } from "@/components/ui/num";
import type { Locale } from "@/i18n/routing";
import { formatKg, formatMinutes, formatNumber, formatSeconds } from "@/lib/format";
import { infeasibilities, isInfeasible } from "@/lib/planner/derive";
import { usePlanner } from "@/stores/planner";

function WakeBanner({ since }: { since: number }) {
  const t = useTranslations("planner.wake");
  const locale = useLocale() as Locale;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-sm"
    >
      <div className="flex flex-col">
        <span className="text-sm font-medium">{t("title")}</span>
        <span className="text-small text-muted">
          {t("elapsed")} <Num>{formatSeconds(seconds, locale)}</Num>
        </span>
      </div>
    </div>
  );
}

function ErrorBanner() {
  const t = useTranslations("planner.error");
  const error = usePlanner((state) => state.error);
  const retry = usePlanner((state) => state.retry);
  if (!error) return null;
  const known = t.has(`causes.${error.code}`);
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-lg border border-danger bg-surface p-4 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <CircleAlert size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-semibold text-danger">{t("title")}</p>
          <p className="text-small">{known ? t(`causes.${error.code}`) : t("causes.unknown")}</p>
        </div>
      </div>
      <Collapsible>
        <CollapsibleTrigger className="text-small text-muted underline-offset-2 hover:underline">
          {t("details")}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="num mt-2 max-h-32 overflow-auto rounded-md bg-surface-2 p-2 text-micro whitespace-pre-wrap">
            {[error.code, error.message, error.detail].filter(Boolean).join("\n")}
          </pre>
        </CollapsibleContent>
      </Collapsible>
      <div>
        <Button variant="outline" onClick={retry}>
          {t("retry")}
        </Button>
      </div>
    </div>
  );
}

function InfeasibleBanner() {
  const t = useTranslations("planner.infeasible");
  const locale = useLocale() as Locale;
  const metrics = usePlanner((state) => state.solution?.metrics ?? null);
  const status = usePlanner((state) => state.status);
  if (!metrics || status === "running" || status === "loading" || !isInfeasible(metrics)) {
    return null;
  }
  const issues = infeasibilities(metrics);
  const format = (kind: string, amount: number): string => {
    if (kind === "overloadKg") return formatKg(amount, locale);
    if (kind === "overtime") return formatMinutes(amount, locale);
    if (kind === "overloadM3") return `${formatNumber(amount, locale, 2)} m³`;
    return formatNumber(amount, locale);
  };
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-warning bg-surface p-4 shadow-sm"
    >
      <TriangleAlert size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-semibold">{t("title")}</p>
        <ul className="flex flex-col gap-0.5 text-small">
          {issues.map((issue) => (
            <li key={issue.kind}>
              {t(`issues.${issue.kind}`, { amount: format(issue.kind, issue.amount) })}
            </li>
          ))}
        </ul>
        <p className="text-small text-muted">{t("hint")}</p>
      </div>
    </div>
  );
}

export function StatusBanners({ className }: { className?: string }) {
  const wakeSince = usePlanner((state) => state.wakeSince);
  return (
    <div className={`flex flex-col gap-2 ${className ?? ""}`}>
      {wakeSince !== null ? <WakeBanner since={wakeSince} /> : null}
      <ErrorBanner />
      <InfeasibleBanner />
    </div>
  );
}
