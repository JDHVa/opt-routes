"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useReducedMotion } from "@/lib/motion/use-reduced-motion";
import { staggerVariants } from "@/lib/motion/variants";
import { START_PRESETS } from "@/lib/presets";
import { cn } from "@/lib/utils";
import { PresetCard } from "./PresetCard";

export function StartPresets({
  variant = "full",
  heading = true,
  className,
}: {
  variant?: "full" | "compact";
  heading?: boolean;
  className?: string;
}) {
  const t = useTranslations("startPresets");
  const reduced = useReducedMotion();
  const compact = variant === "compact";

  return (
    <section aria-labelledby="start-presets-title" className={cn("flex flex-col gap-4", className)}>
      {heading ? (
        <div className="flex flex-col gap-1">
          <h2
            id="start-presets-title"
            className={compact ? "text-h2 font-semibold" : "text-h2 font-semibold md:text-h1 md:tracking-[-0.01em]"}
          >
            {compact ? t("emptyTitle") : t("title")}
          </h2>
          <p className="text-muted">{compact ? t("emptyBody") : t("subtitle")}</p>
        </div>
      ) : null}
      <motion.ul
        initial="hidden"
        animate={compact ? "show" : undefined}
        whileInView={compact ? undefined : "show"}
        viewport={{ once: true, amount: 0.15 }}
        variants={staggerVariants(reduced, 0.05, 0.05)}
        className={cn(
          "grid gap-3",
          compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4",
        )}
      >
        {START_PRESETS.map((preset) => (
          <PresetCard key={preset.id} preset={preset} variant={variant} />
        ))}
      </motion.ul>
    </section>
  );
}
