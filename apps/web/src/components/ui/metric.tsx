"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { InfoTip } from "@/components/ui/info-tip";
import type { ValuePart } from "@/lib/format";
import { useCountUp } from "@/lib/motion/use-count-up";
import { useReducedMotion } from "@/lib/motion/use-reduced-motion";
import { riseVariants, staggerVariants } from "@/lib/motion/variants";
import { cn } from "@/lib/utils";

const DELTA_VISIBLE_MS = 1500;
const MIN_RELATIVE_DELTA = 0.002;

export type MetricFormat = (amount: number) => string | ValuePart[];

type MetricProps = {
  label: string;
  help?: string;
  value?: string | ValuePart[];
  amount?: number;
  format?: MetricFormat;
  lowerIsBetter?: boolean;
  className?: string;
};

function renderValue(value: string | ValuePart[]) {
  if (typeof value === "string") return <span className="num">{value}</span>;
  return value.map((part) => (
    <span key={part.unit} className="whitespace-nowrap">
      <span className="num">{part.value}</span>
      <span className="ml-0.5 text-small font-normal text-muted">{part.unit}</span>
    </span>
  ));
}

function plainText(value: string | ValuePart[]): string {
  return typeof value === "string" ? value : value.map((p) => `${p.value} ${p.unit}`).join(" ");
}

type Delta = { amount: number; token: number };

function AnimatedValue({
  amount,
  format,
  lowerIsBetter,
}: {
  amount: number;
  format: MetricFormat;
  lowerIsBetter: boolean;
}) {
  const animated = useCountUp(amount);
  const previous = useRef(amount);
  const [delta, setDelta] = useState<Delta | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = amount;
    const change = amount - before;
    if (Math.abs(change) <= Math.max(Math.abs(before), 1) * MIN_RELATIVE_DELTA) return;
    const raf = requestAnimationFrame(() => setDelta({ amount: change, token: performance.now() }));
    const timer = setTimeout(() => setDelta(null), DELTA_VISIBLE_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [amount]);

  const improved = delta !== null && delta.amount < 0 === lowerIsBetter;
  const Arrow = delta !== null && delta.amount < 0 ? ArrowDown : ArrowUp;

  return (
    <>
      {renderValue(format(animated))}
      {delta ? (
        <span
          key={delta.token}
          data-testid="metric-delta"
          className={cn(
            "delta-badge num inline-flex items-center gap-0.5 text-micro font-medium",
            improved ? "text-success" : "text-danger",
          )}
        >
          <Arrow size={12} strokeWidth={2} aria-hidden="true" />
          {plainText(format(Math.abs(delta.amount)))}
        </span>
      ) : null}
    </>
  );
}

export function Metric({
  label,
  help,
  value,
  amount,
  format,
  lowerIsBetter = true,
  className,
}: MetricProps) {
  const reduced = useReducedMotion();
  return (
    <motion.div variants={riseVariants(reduced, 8)} className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <dt className="flex items-center gap-0.5 text-micro font-medium text-muted">
        {label}
        {help ? <InfoTip topic={help} className="-my-1" /> : null}
      </dt>
      <dd className="flex flex-wrap items-baseline gap-x-1.5 text-metric font-medium">
        {amount !== undefined && format ? (
          <AnimatedValue amount={amount} format={format} lowerIsBetter={lowerIsBetter} />
        ) : value !== undefined ? (
          renderValue(value)
        ) : null}
      </dd>
    </motion.div>
  );
}

export function MetricGrid({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.dl
      initial="hidden"
      animate="show"
      variants={staggerVariants(reduced, 0.04)}
      className={className}
    >
      {children}
    </motion.dl>
  );
}
