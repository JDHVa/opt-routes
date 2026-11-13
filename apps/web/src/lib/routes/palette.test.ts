import { describe, expect, it } from "vitest";
import { PALETTE_SIZE, ROUTE_PALETTE, routeColor, routeIsDashed } from "./palette";

describe("paleta de rutas", () => {
  it("tiene 12 colores distintos", () => {
    expect(PALETTE_SIZE).toBe(12);
    expect(new Set(ROUTE_PALETTE).size).toBe(12);
  });

  it("asigna el mismo color al mismo índice, siempre", () => {
    for (let i = 0; i < 30; i += 1) expect(routeColor(i)).toBe(routeColor(i));
    expect(routeColor(0)).toBe("#0072B2");
  });

  it("repite la paleta desde el repartidor 13", () => {
    expect(routeColor(12)).toBe(routeColor(0));
    expect(routeColor(25)).toBe(routeColor(1));
  });

  it("los colores contiguos son distintos", () => {
    for (let i = 0; i < 40; i += 1) expect(routeColor(i)).not.toBe(routeColor(i + 1));
  });

  it("desde la ruta 13 la línea es punteada", () => {
    expect(routeIsDashed(11)).toBe(false);
    expect(routeIsDashed(12)).toBe(true);
  });

  it("tolera índices negativos", () => {
    expect(routeColor(-1)).toBe(routeColor(11));
  });
});
