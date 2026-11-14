import { describe, expect, it } from "vitest";
import { stageLabel } from "./stage";

describe("stageLabel", () => {
  it("devuelve null cuando no llega la etapa", () => {
    expect(stageLabel(null, "kmeans")).toBeNull();
    expect(stageLabel(undefined, null)).toBeNull();
  });

  it("la siembra conserva la estrategia de inicialización", () => {
    expect(stageLabel("seeding", "kmeans")).toEqual({ key: "seeding", init: "kmeans" });
  });

  it("las demás etapas se mapean a su clave", () => {
    expect(stageLabel("evolving", "kmeans")).toEqual({ key: "evolving" });
    expect(stageLabel("cooperating", null)).toEqual({ key: "cooperating" });
  });
});
