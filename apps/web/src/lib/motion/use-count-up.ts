"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./use-reduced-motion";

const DURATION_MS = 500;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function useCountUp(target: number, durationMs = DURATION_MS): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    if (reduced || current.current === target) {
      current.current = target;
      const frame = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(frame);
    }
    const from = current.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const next = from + (target - from) * easeOutCubic(progress);
      current.current = next;
      setValue(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else current.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, reduced, durationMs]);

  return value;
}
