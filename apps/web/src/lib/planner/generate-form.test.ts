import { describe, expect, it } from "vitest";
import {
  GENERATE_DEFAULTS,
  toGenerateRequest,
  validateGenerate,
} from "./generate-form";

describe("formulario de generación", () => {
  it("los valores por defecto producen una petición válida con fracciones", () => {
    expect(toGenerateRequest(GENERATE_DEFAULTS)).toEqual({
      n_stops: 60,
      n_drivers: 6,
      mode: "depot",
      time_windows_pct: 0.3,
      high_priority_pct: 0.1,
      dynamic_pct: 0,
      seed: 1,
    });
  });

  it("reporta el código de error por campo", () => {
    const errors = validateGenerate({
      ...GENERATE_DEFAULTS,
      nStops: 1,
      nDrivers: 2.5,
      timeWindowsPct: 140,
      seed: null,
    });
    expect(errors.nStops).toEqual({ code: "min", bound: 2 });
    expect(errors.nDrivers).toEqual({ code: "integer" });
    expect(errors.timeWindowsPct).toEqual({ code: "max", bound: 100 });
    expect(errors.seed).toEqual({ code: "required" });
  });

  it("no genera petición con errores", () => {
    expect(toGenerateRequest({ ...GENERATE_DEFAULTS, nStops: 500 })).toBeNull();
  });
});
