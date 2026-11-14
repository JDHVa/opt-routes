import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import { GLOSSARY_TERMS } from "./glossary";

function keyPaths(node: unknown, prefix = ""): string[] {
  if (node === null || typeof node !== "object") return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    keyPaths(value, prefix ? `${prefix}.${key}` : key),
  );
}

describe("mensajes", () => {
  it("es y en tienen exactamente las mismas claves", () => {
    expect(keyPaths(en).sort()).toEqual(keyPaths(es).sort());
  });

  it("la ayuda cubre métricas, restricciones, algoritmos y modos", () => {
    for (const messages of [es, en]) {
      const help = messages.help as unknown as Record<string, Record<string, { title: string; body: string }>>;
      for (const key of ["distance", "cost", "duration", "makespan", "vehicles", "lateness", "gap"]) {
        expect(help.metrics[key].body.length).toBeGreaterThan(20);
      }
      for (const key of ["capacity_kg", "capacity_m3", "time_windows", "max_shift", "priorities"]) {
        expect(help.constraints[key].title).toBeTruthy();
      }
      for (const key of ["ga", "aco", "aco_ga", "nsga2", "pyvrp", "ortools"]) {
        expect(help.algorithms[key].body.length).toBeGreaterThan(20);
      }
      for (const key of ["depot", "multi_origin"]) expect(help.modes[key].title).toBeTruthy();
    }
  });

  it("el glosario incluye los ocho términos", () => {
    expect(GLOSSARY_TERMS).toHaveLength(8);
    for (const messages of [es, en]) {
      const glossary = messages.help.glossary as unknown as Record<string, { title: string; body: string }>;
      for (const term of GLOSSARY_TERMS) expect(glossary[term].body.length).toBeGreaterThan(15);
    }
  });
});
