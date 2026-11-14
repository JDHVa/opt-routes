import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  oklchToSrgb,
  parseCssTokens,
  parseOklch,
  toHex,
} from "./contrast";

describe("conversión OKLCH a sRGB", () => {
  it("convierte blanco y negro", () => {
    expect(toHex(oklchToSrgb({ l: 1, c: 0, h: 0 }))).toBe("#ffffff");
    expect(toHex(oklchToSrgb({ l: 0, c: 0, h: 0 }))).toBe("#000000");
  });

  it("coincide con un valor de referencia conocido", () => {
    expect(toHex(oklchToSrgb({ l: 0.628, c: 0.2577, h: 29.23 }))).toBe("#ff0000");
  });

  it("la razón de contraste entre blanco y negro es 21", () => {
    expect(contrastRatio([1, 1, 1], [0, 0, 0])).toBeCloseTo(21, 5);
  });
});

describe("lectura de tokens", () => {
  it("lee los valores oklch de un bloque", () => {
    const tokens = parseCssTokens(":root {\n  --bg: oklch(0.985 0.002 250);\n}\n.dark {\n  --bg: oklch(0.1 0 0);\n}", ".dark");
    expect(parseOklch(tokens.bg)).toEqual({ l: 0.1, c: 0, h: 0 });
  });
});
