import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import { PRESET_IDS } from "@/lib/planner/presets";
import {
  findStartPreset,
  presetHref,
  presetsFor,
  silhouetteFor,
  START_PRESET_IDS,
  START_PRESETS,
} from "./presets";

const KNOWN_ALGORITHMS = ["ga", "aco", "aco_ga", "nsga2", "pyvrp", "ortools"];
const TARGET_ALGORITHM = { planner: null, pareto: "nsga2", simulate: null } as const;

describe("presets de inicio", () => {
  it("son seis, con ids únicos y en el orden declarado", () => {
    expect(START_PRESETS).toHaveLength(6);
    expect(START_PRESETS.map((preset) => preset.id)).toEqual([...START_PRESET_IDS]);
    expect(new Set(START_PRESETS.map((preset) => preset.id)).size).toBe(6);
  });

  it("cada preset apunta a un algoritmo, un objetivo y un tiempo válidos", () => {
    for (const preset of START_PRESETS) {
      expect(KNOWN_ALGORITHMS).toContain(preset.algorithm);
      if (preset.objective !== null) expect(PRESET_IDS).toContain(preset.objective);
      expect(preset.timeLimitS).toBeGreaterThan(0);
      expect(preset.timeLimitS).toBeLessThanOrEqual(600);
    }
  });

  it("mapea a la pantalla correcta con ?preset=<id>", () => {
    for (const preset of START_PRESETS) {
      expect(presetHref(preset)).toBe(`/${preset.target}?preset=${preset.id}`);
    }
    expect(presetsFor("pareto").map((p) => p.id)).toEqual(["pareto-tradeoff"]);
    expect(presetsFor("simulate").map((p) => p.id)).toEqual(["live-day"]);
    expect(presetsFor("planner")).toHaveLength(4);
  });

  it("Pareto corre NSGA-II y los de planner traen objetivo", () => {
    for (const preset of START_PRESETS) {
      const forced = TARGET_ALGORITHM[preset.target];
      if (forced) expect(preset.algorithm).toBe(forced);
      if (preset.target === "planner") expect(preset.objective).not.toBeNull();
    }
  });

  it("cada escenario tiene silueta con paradas y depósito", () => {
    for (const preset of START_PRESETS) {
      const silhouette = silhouetteFor(preset.scenarioId);
      expect(silhouette).not.toBeNull();
      expect(silhouette?.stops.length).toBeGreaterThan(10);
      expect(silhouette?.depot).not.toBeNull();
    }
  });

  it("el escenario multi-origen muestra los puntos de partida", () => {
    expect(silhouetteFor("mty-multiorigin-80")?.origins.length).toBeGreaterThan(0);
  });

  it("encuentra presets por id y rechaza ids desconocidos", () => {
    expect(findStartPreset("live-day")?.target).toBe("simulate");
    expect(findStartPreset("nope")).toBeNull();
    expect(findStartPreset(null)).toBeNull();
  });

  it("tiene textos en español e inglés", () => {
    for (const messages of [es, en]) {
      for (const preset of START_PRESETS) {
        const item = messages.startPresets.items[preset.id];
        expect(item.name.length).toBeGreaterThan(3);
        expect(item.blurb.length).toBeGreaterThan(10);
      }
    }
  });
});
