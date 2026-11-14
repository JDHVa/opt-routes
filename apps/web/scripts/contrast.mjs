import { readFileSync } from "node:fs";
import {
  contrastRatio,
  oklchToSrgb,
  parseCssTokens,
  parseOklch,
} from "../src/lib/color/contrast.ts";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

const THEMES = { light: ":root", dark: ".dark" };

const TEXT_PAIRS = [
  ["text", "bg"],
  ["accent-strong", "accent-press"],
  ["accent-strong", "accent-soft"],
  ["accent-fg", "accent-strong"],
  ["text", "surface"],
  ["text", "surface-2"],
  ["text-muted", "bg"],
  ["text-muted", "surface"],
  ["text-muted", "surface-2"],
  ["text-faint", "bg"],
  ["text-faint", "surface"],
  ["text-faint", "surface-2"],
  ["accent", "surface"],
  ["success", "bg"],
  ["success", "surface"],
  ["warning", "bg"],
  ["warning", "surface"],
  ["danger", "bg"],
  ["danger", "surface"],
  ["accent-fg", "accent"],
  ["text", "accent-soft"],
];

const UI_PAIRS = [
  ["accent", "bg"],
  ["accent", "surface"],
  ["text-muted", "surface-2"],
  ["warning", "surface"],
  ["success", "surface"],
  ["danger", "surface"],
  ["accent", "surface-2"],
];

const THEME_TEXT_PAIRS = { light: [["text", "signal"]], dark: [["accent-fg", "signal"]] };
const THEME_UI_PAIRS = { light: [["signal", "text"]], dark: [["signal", "bg"], ["signal", "surface"]] };

function color(tokens, name) {
  const parsed = parseOklch(tokens[name] ?? "");
  if (!parsed) throw new Error(`token --${name} no es oklch`);
  return oklchToSrgb(parsed);
}

let failures = 0;
const rows = [];

for (const [theme, selector] of Object.entries(THEMES)) {
  const tokens = parseCssTokens(css, selector);
  const measure = (pairs, kind, minimum) => {
    for (const [fg, bg] of pairs) {
      const ratio = contrastRatio(color(tokens, fg), color(tokens, bg));
      const pass = ratio >= minimum;
      if (!pass) failures += 1;
      rows.push({ theme, kind, pair: `${fg} / ${bg}`, ratio: ratio.toFixed(2), minimum, pass });
    }
  };
  measure(TEXT_PAIRS, "texto", 4.5);
  measure(UI_PAIRS, "ui", 3);
  measure(THEME_TEXT_PAIRS[theme], "texto", 4.5);
  measure(THEME_UI_PAIRS[theme], "ui", 3);
}

for (const row of rows) {
  const mark = row.pass ? "ok  " : "FAIL";
  console.log(
    `${mark} ${row.theme.padEnd(5)} ${row.kind.padEnd(5)} ${row.pair.padEnd(26)} ${row.ratio.padStart(6)}  (>= ${row.minimum})`,
  );
}

if (failures > 0) {
  console.error(`\n${failures} pares no alcanzan el contraste mínimo`);
  process.exit(1);
}
