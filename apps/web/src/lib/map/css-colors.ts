export const MAP_COLOR_TOKENS = [
  "bg",
  "surface",
  "text",
  "text-muted",
  "danger",
  "accent",
  "success",
] as const;

export type MapColorToken = (typeof MAP_COLOR_TOKENS)[number];
export type MapColors = Record<MapColorToken, string>;

export const FALLBACK_MAP_COLORS: MapColors = {
  bg: "rgb(250, 250, 251)",
  surface: "rgb(255, 255, 255)",
  text: "rgb(30, 33, 38)",
  "text-muted": "rgb(98, 104, 114)",
  danger: "rgb(196, 52, 38)",
  accent: "rgb(30, 100, 200)",
  success: "rgb(36, 130, 84)",
};

let scratch: CanvasRenderingContext2D | null = null;

export function cssColorToRgb(value: string): string | null {
  if (typeof document === "undefined") return null;
  if (!scratch) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    scratch = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (!scratch) return null;
  scratch.clearRect(0, 0, 1, 1);
  scratch.fillStyle = "#000";
  scratch.fillStyle = value;
  scratch.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = scratch.getImageData(0, 0, 1, 1).data;
  return a === 0 ? null : `rgb(${r}, ${g}, ${b})`;
}

export function readMapColors(root: HTMLElement): MapColors {
  const style = getComputedStyle(root);
  const colors = { ...FALLBACK_MAP_COLORS };
  for (const token of MAP_COLOR_TOKENS) {
    const raw = style.getPropertyValue(`--${token}`).trim();
    const rgb = raw ? cssColorToRgb(raw) : null;
    if (rgb) colors[token] = rgb;
  }
  return colors;
}
