"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useReducedMotion } from "@/lib/motion/use-reduced-motion";
import { PRESET_QUERY_PARAM } from "@/lib/presets";

export const COACH_STORAGE_KEY = "routeopt:coach:v1";
const STEPS = ["stops", "fleet", "algorithm", "optimize"] as const;
const START_DELAY_MS = 900;
const CARD_WIDTH = 288;
const GAP = 12;

type Rect = { top: number; left: number; width: number; height: number; edge: number };

export function readCoachDone(): boolean {
  try {
    return window.localStorage.getItem(COACH_STORAGE_KEY) === "done";
  } catch {
    return false;
  }
}

export function writeCoachDone(): void {
  try {
    window.localStorage.setItem(COACH_STORAGE_KEY, "done");
  } catch {
    return;
  }
}

function measure(step: (typeof STEPS)[number]): Rect | null {
  const element = document.querySelector<HTMLElement>(`[data-coach="${step}"]`);
  if (!element) return null;
  const box = element.getBoundingClientRect();
  const edge = element.closest("aside")?.getBoundingClientRect().right ?? box.left + box.width;
  return { top: box.top, left: box.left, width: box.width, height: box.height, edge };
}

export function Coachmarks({ enabled }: { enabled: boolean }) {
  const t = useTranslations("planner.coach");
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (!enabled || readCoachDone()) return;
    if (window.location.search.includes(`${PRESET_QUERY_PARAM}=`)) return;
    const timer = setTimeout(() => setOpen(true), START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [enabled]);

  const close = useCallback(() => {
    writeCoachDone();
    setOpen(false);
  }, []);

  useEffect(() => {
    if (open && !enabled) writeCoachDone();
  }, [open, enabled]);

  useEffect(() => {
    if (!open) return;
    const update = () => setRect(measure(STEPS[index]));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open, index]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open || !enabled || !rect) return null;

  const step = STEPS[index];
  const last = index === STEPS.length - 1;
  const left = Math.min(rect.edge + GAP, window.innerWidth - CARD_WIDTH - GAP);
  const top = Math.max(64, Math.min(rect.top - 8, window.innerHeight - 240));

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      <motion.div
        aria-hidden="true"
        initial={false}
        animate={{
          top: rect.top - 4,
          left: rect.left - 4,
          width: rect.width + 8,
          height: rect.height + 8,
        }}
        transition={reduced ? { duration: 0.1 } : { type: "spring", stiffness: 260, damping: 30 }}
        className="absolute rounded-lg border-2 border-accent"
      />
      <AnimatePresence mode="wait">
        <motion.section
          key={step}
          role="dialog"
          aria-label={t("label")}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.1 } }}
          transition={reduced ? { duration: 0.1 } : { type: "spring", stiffness: 260, damping: 30 }}
          style={{ top, left, width: CARD_WIDTH }}
          className="pointer-events-auto absolute flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm"
        >
          <div className="flex flex-col gap-1">
            <p className="th-micro text-muted">
              {t("step", { current: index + 1, total: STEPS.length })}
            </p>
            <h2 className="text-sm font-semibold">
              {t(`steps.${step}.title`)}
            </h2>
            <p className="text-small text-muted">{t(`steps.${step}.body`)}</p>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={close}>
              {t("skip")}
            </Button>
            <div className="flex gap-2">
              {index > 0 ? (
                <Button variant="outline" size="sm" onClick={() => setIndex(index - 1)}>
                  {t("back")}
                </Button>
              ) : null}
              <Button size="sm" onClick={last ? close : () => setIndex(index + 1)}>
                {last ? t("done") : t("next")}
              </Button>
            </div>
          </div>
        </motion.section>
      </AnimatePresence>
    </div>
  );
}
