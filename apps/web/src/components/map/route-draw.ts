import type { ExpressionSpecification, FilterSpecification, Map as MapLibreMap } from "maplibre-gl";

export const DRAW_DURATION_MS = 600;
export const DRAW_STAGGER_MS = 60;
const MAX_TOTAL_STAGGER_MS = 900;
const BASE_LAYERS = ["route-casing", "route-line", "route-line-dashed", "route-arrows"] as const;
const ANCHOR_LAYER = "route-arrows";
const TRANSPARENT = "rgba(0, 0, 0, 0)";
const MIN_PROGRESS = 0.0001;

export type DrawTarget = { driverIndex: number; color: string };

export type DrawOptions = {
  background: string;
  onDone?: () => void;
};

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function gradientFor(color: string, progress: number): ExpressionSpecification {
  if (progress >= 1) {
    return ["interpolate", ["linear"], ["line-progress"], 0, color, 1, color];
  }
  return ["step", ["line-progress"], color, Math.max(progress, MIN_PROGRESS), TRANSPARENT];
}

function overlayIds(driverIndex: number): { casing: string; line: string } {
  return { casing: `route-draw-casing-${driverIndex}`, line: `route-draw-line-${driverIndex}` };
}

function setBaseVisibility(map: MapLibreMap, visibility: "visible" | "none"): void {
  for (const id of BASE_LAYERS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visibility);
  }
}

function removeOverlays(map: MapLibreMap, targets: DrawTarget[]): void {
  for (const target of targets) {
    const ids = overlayIds(target.driverIndex);
    if (map.getLayer(ids.line)) map.removeLayer(ids.line);
    if (map.getLayer(ids.casing)) map.removeLayer(ids.casing);
  }
}

export function startRouteDraw(
  map: MapLibreMap,
  targets: DrawTarget[],
  options: DrawOptions,
): () => void {
  if (targets.length === 0 || !map.getLayer(ANCHOR_LAYER)) {
    options.onDone?.();
    return () => undefined;
  }
  const ordered = [...targets].sort((a, b) => a.driverIndex - b.driverIndex);
  const stagger = Math.min(DRAW_STAGGER_MS, MAX_TOTAL_STAGGER_MS / ordered.length);
  setBaseVisibility(map, "none");
  for (const target of ordered) {
    const ids = overlayIds(target.driverIndex);
    const filter: FilterSpecification = ["==", ["get", "driverIndex"], target.driverIndex];
    const layout = { "line-join": "round", "line-cap": "round" } as const;
    removeOverlays(map, [target]);
    map.addLayer(
      {
        id: ids.casing,
        type: "line",
        source: "routes",
        filter,
        layout,
        paint: {
          "line-width": 7,
          "line-opacity": 0.9,
          "line-gradient": gradientFor(options.background, 0),
        },
      },
      ANCHOR_LAYER,
    );
    map.addLayer(
      {
        id: ids.line,
        type: "line",
        source: "routes",
        filter,
        layout,
        paint: { "line-width": 4, "line-gradient": gradientFor(target.color, 0) },
      },
      ANCHOR_LAYER,
    );
  }

  const total = DRAW_DURATION_MS + stagger * (ordered.length - 1);
  const start = performance.now();
  const lastProgress = new Map<number, number>();
  let frame = 0;
  let cancelled = false;

  const finish = () => {
    if (!map.getStyle()) return;
    removeOverlays(map, ordered);
    setBaseVisibility(map, "visible");
  };

  const tick = (now: number) => {
    if (cancelled) return;
    const elapsed = now - start;
    ordered.forEach((target, index) => {
      const raw = (elapsed - index * stagger) / DRAW_DURATION_MS;
      const progress = easeOutCubic(Math.min(1, Math.max(0, raw)));
      const rounded = Math.round(progress * 200) / 200;
      if (lastProgress.get(target.driverIndex) === rounded) return;
      lastProgress.set(target.driverIndex, rounded);
      const ids = overlayIds(target.driverIndex);
      if (map.getLayer(ids.line)) {
        map.setPaintProperty(ids.line, "line-gradient", gradientFor(target.color, rounded));
        map.setPaintProperty(ids.casing, "line-gradient", gradientFor(options.background, rounded));
      }
    });
    if (elapsed >= total) {
      finish();
      options.onDone?.();
      return;
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
    finish();
  };
}
