import { describe, expect, it } from "vitest";
import { hybridContribution } from "./hybrid";

describe("hybridContribution", () => {
  it("devuelve null si faltan los contadores", () => {
    expect(hybridContribution({})).toBeNull();
    expect(hybridContribution({ improvements_from_ga: 3 })).toBeNull();
    expect(hybridContribution({ improvements_from_ga: "3", improvements_from_aco: 1 })).toBeNull();
  });

  it("calcula la proporción aportada por el GA", () => {
    expect(hybridContribution({ improvements_from_ga: 3, improvements_from_aco: 1 })).toEqual({
      ga: 3,
      aco: 1,
      gaShare: 0.75,
    });
  });

  it("reparte a partes iguales cuando aún no hay mejoras", () => {
    expect(hybridContribution({ improvements_from_ga: 0, improvements_from_aco: 0 })?.gaShare).toBe(
      0.5,
    );
  });
});
