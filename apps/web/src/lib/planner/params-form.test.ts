import { describe, expect, it } from "vitest";
import algorithms from "@/test/data/algorithms.json";
import {
  buildParamFields,
  defaultValues,
  splitFields,
  toRunParams,
  validateParams,
} from "./params-form";

const byName = (name: string) => {
  const info = algorithms.find((a) => a.name === name);
  if (!info) throw new Error(`falta ${name}`);
  return info;
};

describe("buildParamFields con el schema real del solver", () => {
  it("genera un campo por propiedad del schema", () => {
    for (const info of algorithms) {
      const fields = buildParamFields(info.params_schema);
      expect(fields.map((f) => f.key)).toEqual(Object.keys(info.params_schema.properties));
    }
  });

  it("resuelve $ref a enum con su default", () => {
    const fields = buildParamFields(byName("ga").params_schema);
    const init = fields.find((f) => f.key === "init");
    expect(init).toMatchObject({
      kind: "enum",
      defaultValue: "kmeans",
      options: ["random", "nearest_neighbor", "kmeans", "sweep"],
    });
  });

  it("detecta enums en línea", () => {
    const fields = buildParamFields(byName("ga").params_schema);
    expect(fields.find((f) => f.key === "crossover")).toMatchObject({
      kind: "enum",
      options: ["ox", "pmx"],
      defaultValue: "ox",
    });
  });

  it("detecta enteros anulables (seed)", () => {
    const fields = buildParamFields(byName("aco").params_schema);
    expect(fields.find((f) => f.key === "seed")).toMatchObject({
      kind: "integer",
      nullable: true,
      defaultValue: null,
    });
  });

  it("detecta booleanos y límites numéricos", () => {
    const fields = buildParamFields(byName("aco").params_schema);
    expect(fields.find((f) => f.key === "local_search")).toMatchObject({
      kind: "boolean",
      defaultValue: true,
    });
    expect(fields.find((f) => f.key === "rho")).toMatchObject({
      kind: "number",
      exclusiveMin: 0,
      exclusiveMax: 1,
      defaultValue: 0.1,
    });
    expect(fields.find((f) => f.key === "time_limit_s")).toMatchObject({
      exclusiveMin: 0,
      max: 600,
    });
  });

  it("los defaults pasan la validación", () => {
    for (const info of algorithms) {
      const fields = buildParamFields(info.params_schema);
      expect(validateParams(fields, defaultValues(fields)).ok).toBe(true);
    }
  });
});

describe("validateParams", () => {
  const fields = buildParamFields(byName("aco").params_schema);

  it("rechaza fuera de rango", () => {
    const values = { ...defaultValues(fields), rho: 1.5, time_limit_s: 0 };
    const { ok, errors } = validateParams(fields, values);
    expect(ok).toBe(false);
    expect(errors.rho).toEqual({ code: "max", bound: 1 });
    expect(errors.time_limit_s).toEqual({ code: "min", bound: 0 });
  });

  it("rechaza decimales en enteros y vacíos obligatorios", () => {
    const values = { ...defaultValues(fields), n_ants: 2.5, max_iterations: null };
    const { errors } = validateParams(fields, values);
    expect(errors.n_ants?.code).toBe("integer");
    expect(errors.max_iterations?.code).toBe("required");
  });

  it("permite vacío en campos anulables", () => {
    const values = { ...defaultValues(fields), seed: null };
    expect(validateParams(fields, values).ok).toBe(true);
  });
});

describe("splitFields y toRunParams", () => {
  it("muestra 3 o 4 parámetros clave y el resto en avanzado", () => {
    for (const info of algorithms) {
      const fields = buildParamFields(info.params_schema);
      const { key, advanced } = splitFields(info.name, fields);
      expect(key.length).toBeGreaterThanOrEqual(3);
      expect(key.length).toBeLessThanOrEqual(4);
      expect(key.length + advanced.length).toBe(fields.length);
    }
  });

  it("quita los nulos al armar los parámetros de la corrida", () => {
    const fields = buildParamFields(byName("ga").params_schema);
    const params = toRunParams(defaultValues(fields));
    expect(params).not.toHaveProperty("seed");
    expect(params).toMatchObject({ time_limit_s: 30, init: "kmeans", local_search: true });
  });
});
