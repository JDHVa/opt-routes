import { describe, expect, it } from "vitest";
import depotProblem from "@/test/fixtures/mty-centro-depot-40.problem.json";
import { createRateLimiter } from "./rate-limit";
import { isAllowed, isRateLimited, validateBody } from "./validation";

describe("rate limiter", () => {
  it("permite hasta el límite y luego bloquea con retry-after", () => {
    const limiter = createRateLimiter(3, 60_000);
    expect(limiter.hit("a", 0).allowed).toBe(true);
    expect(limiter.hit("a", 1000).allowed).toBe(true);
    expect(limiter.hit("a", 2000).allowed).toBe(true);
    const blocked = limiter.hit("a", 3000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterS).toBe(57);
  });

  it("es independiente por IP y se libera al pasar la ventana", () => {
    const limiter = createRateLimiter(1, 1000);
    expect(limiter.hit("a", 0).allowed).toBe(true);
    expect(limiter.hit("b", 0).allowed).toBe(true);
    expect(limiter.hit("a", 500).allowed).toBe(false);
    expect(limiter.hit("a", 1500).allowed).toBe(true);
  });
});

describe("rutas permitidas del proxy", () => {
  it("solo reenvía rutas conocidas", () => {
    expect(isAllowed("GET", "algorithms")).toBe(true);
    expect(isAllowed("GET", "scenarios/mty-centro-depot-40")).toBe(true);
    expect(isAllowed("POST", "solve/stream")).toBe(true);
    expect(isAllowed("POST", "scenarios/generate")).toBe(true);
    expect(isAllowed("POST", "import/csv")).toBe(true);
    expect(isAllowed("POST", "algorithms")).toBe(false);
    expect(isAllowed("GET", "../etc/passwd")).toBe(false);
    expect(isAllowed("GET", "docs")).toBe(false);
  });

  it("limita solo solve y compare", () => {
    expect(isRateLimited("solve/stream")).toBe(true);
    expect(isRateLimited("compare")).toBe(true);
    expect(isRateLimited("vehicles")).toBe(false);
  });
});

describe("validateBody", () => {
  const run = { algorithm: "ga", params: {} };

  it("acepta un SolveRequest válido", () => {
    const body = JSON.stringify({ problem: depotProblem, run, include_geometry: true });
    expect(validateBody("solve", body)).toEqual({ ok: true });
  });

  it("rechaza JSON inválido, sin paradas o sin algoritmo", () => {
    expect(validateBody("solve", "{").ok).toBe(false);
    const noStops = JSON.stringify({ problem: { stops: [], drivers: [{}] }, run });
    expect(validateBody("solve", noStops).ok).toBe(false);
    const noAlgorithm = JSON.stringify({ problem: depotProblem, run: {} });
    expect(validateBody("solve/stream", noAlgorithm).ok).toBe(false);
  });

  it("valida compare con una lista de corridas", () => {
    const ok = JSON.stringify({ problem: depotProblem, runs: [run] });
    expect(validateBody("compare", ok).ok).toBe(true);
    const empty = JSON.stringify({ problem: depotProblem, runs: [] });
    expect(validateBody("compare", empty).ok).toBe(false);
  });

  it("no valida cuerpos de otras rutas", () => {
    expect(validateBody("matrix", "cualquier cosa")).toEqual({ ok: true });
  });
});
