"use client";

import { useEffect, useState } from "react";
import { usePlanner } from "@/stores/planner";

const TICK_MS = 100;

export function useRunFraction(): number {
  const status = usePlanner((state) => state.status);
  const startedAt = usePlanner((state) => state.startedAt);
  const limit = usePlanner((state) => {
    const value = state.paramValues.time_limit_s;
    return typeof value === "number" && value > 0 ? value : null;
  });
  const [fraction, setFraction] = useState(0);
  const busy = status === "loading" || status === "running";

  useEffect(() => {
    if (!busy || startedAt === null || limit === null) {
      const reset = requestAnimationFrame(() => setFraction(0));
      return () => cancelAnimationFrame(reset);
    }
    const update = () => setFraction(Math.min(1, (Date.now() - startedAt) / 1000 / limit));
    update();
    const timer = setInterval(update, TICK_MS);
    return () => clearInterval(timer);
  }, [busy, startedAt, limit]);

  return fraction;
}
