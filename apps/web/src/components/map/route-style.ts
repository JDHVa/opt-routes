import type { ExpressionSpecification } from "maplibre-gl";

export const DIM: ExpressionSpecification = ["==", ["get", "emphasis"], "dim"];
export const SELECTED: ExpressionSpecification = ["==", ["get", "emphasis"], "selected"];

export const DIM_OPACITY = 0.25;
export const CASING_OPACITY = 0.9;
export const CROSSFADE_MS = 150;
export const CROSSFADE_DIP = 0.45;

export function routeOpacity(base: number): ExpressionSpecification {
  return ["case", DIM, DIM_OPACITY, base];
}

export const CROSSFADE_LAYERS: { id: string; property: "line-opacity" | "icon-opacity"; base: number }[] = [
  { id: "route-casing", property: "line-opacity", base: CASING_OPACITY },
  { id: "route-line", property: "line-opacity", base: 1 },
  { id: "route-line-dashed", property: "line-opacity", base: 1 },
  { id: "route-arrows", property: "icon-opacity", base: 1 },
];
