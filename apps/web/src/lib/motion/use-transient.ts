"use client";

import { useEffect, useState } from "react";

export function useTransient(token: number, durationMs: number): boolean {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (token === 0) return;
    const raf = requestAnimationFrame(() => setActive(true));
    const timer = setTimeout(() => setActive(false), durationMs);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [token, durationMs]);

  return active;
}
