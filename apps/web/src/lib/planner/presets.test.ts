import { describe, expect, it } from "vitest";
import {
  detectPreset,
  normalizeWeights,
  PRESET_IDS,
  presetToWeights,
} from "./presets";

describe("presets de objetivo", () => {
  it("Más rápido pone el mayor peso en makespan", () => {
    const w = presetToWeights("fastest");
    expect(w.makespan).toBeGreaterThan(w.time);
    expect(w.makespan).toBeGreaterThan(w.cost);
    expect(w.makespan).toBeGreaterThan(w.vehicles);
  });

  it("Más barato pone el mayor peso en costo", () => {
    const w = presetToWeights("cheapest");
    expect(w.cost).toBeGreaterThan(w.time);
    expect(w.cost).toBeGreaterThan(w.makespan);
  });

  it("Menos repartidores pone el mayor peso en vehículos", () => {
    const w = presetToWeights("fewest");
    expect(w.vehicles).toBeGreaterThan(w.cost);
    expect(w.vehicles).toBeGreaterThan(w.makespan);
  });

  it("Balanceado reparte el peso entre los cuatro objetivos", () => {
    const w = normalizeWeights(presetToWeights("balanced"));
    for (const value of Object.values(w)) expect(value).toBeGreaterThan(0.1);
  });

  it("normaliza a suma 1", () => {
    for (const id of PRESET_IDS) {
      const w = normalizeWeights(presetToWeights(id));
      expect(w.time + w.cost + w.vehicles + w.makespan).toBeCloseTo(1, 10);
    }
  });

  it("detecta el preset a partir de los pesos, aunque estén escalados", () => {
    for (const id of PRESET_IDS) {
      const w = presetToWeights(id);
      expect(detectPreset(w)).toBe(id);
      expect(
        detectPreset({ time: w.time * 3, cost: w.cost * 3, vehicles: w.vehicles * 3, makespan: w.makespan * 3 }),
      ).toBe(id);
    }
  });

  it("devuelve null para pesos personalizados", () => {
    expect(detectPreset({ time: 1, cost: 0, vehicles: 1, makespan: 0 })).toBeNull();
  });

  it("devuelve una copia, no el objeto compartido", () => {
    const a = presetToWeights("fastest");
    a.time = 99;
    expect(presetToWeights("fastest").time).not.toBe(99);
  });
});
