import { describe, expect, it } from "vitest";
import type { Problem } from "@/lib/api/types";
import { SIM_FORM_DEFAULTS, toSimulationConfig, validateSimForm } from "./config";

const PROBLEM = { stops: [], drivers: [] } as unknown as Problem;

describe("configuración de la simulación", () => {
  it("arma el mensaje start con el tiempo del plan inicial en los params", () => {
    const config = toSimulationConfig(PROBLEM, { ...SIM_FORM_DEFAULTS, algorithm: "aco_ga", speed: 120 });
    expect(config).toMatchObject({
      run: { algorithm: "aco_ga", params: { time_limit_s: 10 } },
      speed: 120,
      trigger: "event",
      reopt_time_limit_s: 5,
    });
  });

  it("exige los minutos del lote solo en modo batch", () => {
    expect(validateSimForm({ ...SIM_FORM_DEFAULTS, batchMinutes: null })).toEqual({});
    expect(
      validateSimForm({ ...SIM_FORM_DEFAULTS, trigger: "batch", batchMinutes: null }).batchMinutes,
    ).toBe("required");
  });

  it("rechaza límites fuera de rango y no genera configuración", () => {
    const form = { ...SIM_FORM_DEFAULTS, reoptTimeLimitS: 61, initialTimeLimitS: 0 };
    const errors = validateSimForm(form);
    expect(errors.reoptTimeLimitS).toBe("max");
    expect(errors.initialTimeLimitS).toBe("min");
    expect(toSimulationConfig(PROBLEM, form)).toBeNull();
  });
});
