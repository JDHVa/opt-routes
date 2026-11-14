"use client";

import { useEffect, useState } from "react";
import {
  FALLBACK_MAP_COLORS,
  readMapColors,
  type MapColors,
} from "@/lib/map/css-colors";
import { useReducedMotion } from "@/lib/motion/use-reduced-motion";

export function useMapColors(): MapColors {
  const [colors, setColors] = useState<MapColors>(FALLBACK_MAP_COLORS);

  useEffect(() => {
    const root = document.documentElement;
    const refresh = () => setColors(readMapColors(root));
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(root, { attributes: true, attributeFilter: ["class", "style"] });
    return () => observer.disconnect();
  }, []);

  return colors;
}

export function usePrefersReducedMotion(): boolean {
  return useReducedMotion();
}
