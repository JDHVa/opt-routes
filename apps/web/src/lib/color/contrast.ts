export type Rgb = [number, number, number];

export type Oklch = { l: number; c: number; h: number };

export function parseOklch(value: string): Oklch | null {
  const match = value
    .trim()
    .match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/);
  if (!match) return null;
  return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]) };
}

function linearToSrgb(channel: number): number {
  const clamped = Math.min(1, Math.max(0, channel));
  return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function oklchToSrgb({ l, c, h }: Oklch): Rgb {
  const hue = (h * Math.PI) / 180;
  const a = c * Math.cos(hue);
  const b = c * Math.sin(hue);
  const lp = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mp = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sp = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = 4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp;
  const g = -1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp;
  const bl = -0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp;
  return [linearToSrgb(r), linearToSrgb(g), linearToSrgb(bl)];
}

export function relativeLuminance([r, g, bl]: Rgb): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(bl);
}

export function contrastRatio(foreground: Rgb, background: Rgb): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [light, dark] = a >= b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b]
    .map((channel) =>
      Math.round(Math.min(1, Math.max(0, channel)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

export function parseCssTokens(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return {};
  const end = css.indexOf("}", start);
  const block = css.slice(start, end);
  const tokens: Record<string, string> = {};
  for (const match of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    tokens[match[1]] = match[2].trim();
  }
  return tokens;
}
