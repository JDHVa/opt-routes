import { expect, test, type Page } from "@playwright/test";
import { settleMap, SHOTS, setTheme } from "./helpers";
import { mockSolver } from "./mocks";
import { mockSimulation } from "./sim-mock";

type SolveBody = {
  problem: { objective: { weights: Record<string, number> }; stops: unknown[] };
  run: { algorithm: string; params: Record<string, number> };
};

async function openPresets(page: Page) {
  await page.goto("/es");
  const section = page.getByRole("region", { name: "Pruébalo ahora" });
  await section.scrollIntoViewIfNeeded();
  return section;
}

test.describe("presets de inicio", () => {
  test("la landing muestra seis tarjetas con minimapa, chips y destino", async ({ page }) => {
    await mockSolver(page);
    const section = await openPresets(page);
    const cards = section.getByRole("link");
    await expect(cards).toHaveCount(6);
    await expect(section.locator("svg circle").first()).toBeAttached();
    await expect(section.getByText("Entrega rápida en el centro")).toBeVisible();
    await expect(section.getByText("ACO+GA").first()).toBeVisible();
    await expect(section.getByText("Simulación").first()).toBeVisible();
  });

  test("click en preset: la optimización arranca sola con su algoritmo y objetivo", async ({
    page,
  }) => {
    const solver = await mockSolver(page);
    const section = await openPresets(page);
    await section.getByRole("link", { name: "Probar: Entrega rápida en el centro" }).click();

    await expect(page).toHaveURL(/\/es\/planner$/);
    await expect(page.getByRole("heading", { name: "Resultado" })).toBeVisible();
    expect(solver.solveRequests).toHaveLength(1);
    const body = solver.solveRequests[0] as SolveBody;
    expect(body.run.algorithm).toBe("ga");
    expect(body.run.params.time_limit_s).toBe(10);
    const weights = body.problem.objective.weights;
    expect(weights.makespan).toBeGreaterThan(weights.cost);
    expect(body.problem.stops).toHaveLength(40);
  });

  test("el preset híbrido arranca ACO+GA", async ({ page }) => {
    const solver = await mockSolver(page);
    const section = await openPresets(page);
    await section.getByRole("link", { name: "Probar: Flota mixta en todo Monterrey" }).click();
    await expect(page.getByRole("heading", { name: "Resultado" })).toBeVisible();
    expect((solver.solveRequests[0] as SolveBody).run.algorithm).toBe("aco_ga");
  });

  test("el preset de Pareto corre NSGA-II y muestra el frente", async ({ page }) => {
    const solver = await mockSolver(page);
    const section = await openPresets(page);
    await section.getByRole("link", { name: "Probar: Costo vs rapidez (Pareto)" }).click();
    await expect(page).toHaveURL(/\/es\/pareto$/);
    await expect(page.getByTestId("pareto-point")).toHaveCount(7);
    expect((solver.solveRequests[0] as SolveBody).run.algorithm).toBe("nsga2");
  });

  test("el preset de simulación inicia la simulación solo", async ({ page }) => {
    await mockSolver(page);
    const sim = await mockSimulation(page);
    const section = await openPresets(page);
    await section.getByRole("link", { name: "Probar: Día con pedidos en vivo" }).click();
    await expect(page).toHaveURL(/\/es\/simulate$/);
    await expect(page.getByTestId("sim-driver").first()).toBeVisible();
    expect(sim.received.find((message) => message.type === "start")).toMatchObject({
      config: { run: { algorithm: "ga" } },
    });
  });

  test("el estado vacío del Planner ofrece los mismos presets", async ({ page }) => {
    const solver = await mockSolver(page);
    await page.goto("/es/planner");
    const panel = page.getByRole("complementary", { name: "Configuración del problema" });
    await expect(panel.getByRole("link")).toHaveCount(6);
    await panel.getByRole("link", { name: "Probar: Repartidores desde casa" }).click();
    await expect(page.getByRole("heading", { name: "Resultado" })).toBeVisible();
    expect((solver.solveRequests[0] as SolveBody).run.algorithm).toBe("aco");
  });

  test("capturas de la landing con presets", async ({ page }) => {
    await mockSolver(page);
    await setTheme(page, "light");
    await page.goto("/es");
    await settleMap(page);
    await page.screenshot({ path: `${SHOTS}/landing-light.png` });
    const section = page.getByRole("region", { name: "Pruébalo ahora" });
    await section.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOTS}/landing-presets-light.png` });
    await setTheme(page, "dark");
    await page.reload();
    await settleMap(page);
    await page.screenshot({ path: `${SHOTS}/landing-dark.png` });
    await page.getByRole("region", { name: "Pruébalo ahora" }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOTS}/landing-presets-dark.png` });
  });
});
