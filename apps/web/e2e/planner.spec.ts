import { expect, test, type Page } from "@playwright/test";
import depotSolution from "../src/test/fixtures/mty-centro-depot-40.solution.json";
import { mockSolver } from "./mocks";

const SHOTS = "test-results/screenshots";
const MAP_SETTLE_MS = 4000;

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: theme });
}

async function settleMap(page: Page) {
  await page.locator("canvas.maplibregl-canvas").first().waitFor({ state: "visible" });
  await page.waitForTimeout(MAP_SETTLE_MS);
}

async function openDemoAndOptimize(page: Page) {
  await page.goto("/es/planner?demo=1");
  await expect(page.getByRole("button", { name: /^s001/ })).toBeVisible();
  await page.getByRole("button", { name: "Optimizar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Resultado" })).toBeVisible();
}

test.describe("flujo principal", () => {
  test("landing, abrir demo, optimizar y ver métricas y rutas", async ({ page }) => {
    const solver = await mockSolver(page);
    await page.goto("/es");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Optimiza rutas de reparto con algoritmos genéticos",
    );
    await page.getByRole("link", { name: "Abrir demo Monterrey" }).click();
    await expect(page).toHaveURL(/\/es\/planner\?demo=1/);

    await expect(
      page.getByRole("complementary", { name: "Configuración del problema" }).getByRole("heading", { level: 3 }),
    ).toContainText("40");
    await page.getByRole("button", { name: "Optimizar", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Resultado" })).toBeVisible();
    await expect(page.getByText("Factible", { exact: true })).toBeVisible();
    await expect(page.getByText("Distancia", { exact: true })).toBeVisible();

    const routes = depotSolution.solution.routes;
    const legend = page.getByRole("complementary", { name: "Resultados" });
    await expect(legend.getByRole("button", { expanded: false })).toHaveCount(routes.length);

    await legend.getByRole("button", { expanded: false }).first().click();
    await expect(legend.getByRole("table")).toBeVisible();
    await expect(legend.getByRole("row")).toHaveCount(routes[0].visits.length + 1);

    expect(solver.solveRequests).toHaveLength(1);
    const body = solver.solveRequests[0] as { run: { algorithm: string }; problem: { stops: unknown[] } };
    expect(body.run.algorithm).toBeTruthy();
    expect(body.problem.stops).toHaveLength(40);
  });

  test("el selector de presets cambia el objetivo enviado", async ({ page }) => {
    const solver = await mockSolver(page);
    await page.goto("/es/planner?demo=1");
    await expect(page.getByRole("button", { name: /^s001/ })).toBeVisible();
    await page.getByRole("tab", { name: "Algoritmo" }).click();
    await page.getByRole("button", { name: "Más barato" }).click();
    await page.getByRole("button", { name: "Optimizar", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Resultado" })).toBeVisible();
    const body = solver.solveRequests[0] as { problem: { objective: { weights: { cost: number; makespan: number } } } };
    expect(body.problem.objective.weights.cost).toBeGreaterThan(body.problem.objective.weights.makespan);
  });

  test("muestra el error del solver con Reintentar", async ({ page }) => {
    await mockSolver(page, { failSolve: true });
    await page.goto("/es/planner?demo=1");
    await expect(page.getByRole("button", { name: /^s001/ })).toBeVisible();
    await page.getByRole("button", { name: "Optimizar", exact: true }).click();
    const alert = page.getByRole("alert").filter({ hasText: "No se pudo completar" });
    await expect(alert).toContainText("No se pudo completar la operación");
    await expect(alert.getByRole("button", { name: "Reintentar" })).toBeVisible();
  });

  test("el idioma cambia la interfaz", async ({ page }) => {
    await mockSolver(page);
    await page.goto("/en/planner");
    await expect(page.getByText("No stops yet")).toBeVisible();
    await expect(page.getByRole("button", { name: "Load Monterrey demo" })).toBeVisible();
  });

  test("la paleta de comandos abre con Ctrl+K y carga la demo", async ({ page }) => {
    await mockSolver(page);
    await page.goto("/es/planner");
    await expect(page.getByRole("button", { name: "Cargar demo Monterrey" })).toBeVisible();
    await expect(async () => {
      await page.keyboard.press("Control+k");
      await expect(page.getByRole("option", { name: "Cargar demo Monterrey" })).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await page.getByRole("option", { name: "Cargar demo Monterrey" }).click();
    await expect(page.getByRole("button", { name: /^s001/ })).toBeVisible();
  });
});

test("el proxy responde 502 con ErrorPayload si el solver no responde", async ({ request }) => {
  const response = await request.get("/api/solver/algorithms");
  expect(response.status()).toBe(502);
  expect(await response.json()).toMatchObject({ code: "solver_unreachable" });
});

test.describe("capturas", () => {
  test("landing claro y oscuro", async ({ page }) => {
    await mockSolver(page);
    await setTheme(page, "light");
    await page.goto("/es");
    await settleMap(page);
    await page.screenshot({ path: `${SHOTS}/landing-light.png`, fullPage: false });
    await page.screenshot({ path: `${SHOTS}/landing-light-full.png`, fullPage: true });

    await setTheme(page, "dark");
    await page.reload();
    await settleMap(page);
    await page.screenshot({ path: `${SHOTS}/landing-dark.png`, fullPage: false });
  });

  test("planner vacío claro", async ({ page }) => {
    await mockSolver(page);
    await setTheme(page, "light");
    await page.goto("/es/planner");
    await settleMap(page);
    await page.screenshot({ path: `${SHOTS}/planner-empty-light.png` });
  });

  test("planner con solución, claro y oscuro", async ({ page }) => {
    await mockSolver(page);
    await setTheme(page, "light");
    await openDemoAndOptimize(page);
    await settleMap(page);
    await page.screenshot({ path: `${SHOTS}/planner-solution-light.png` });

    await page.getByRole("tab", { name: "Algoritmo" }).click();
    await page.getByRole("button", { name: "Avanzado" }).click();
    await page.screenshot({ path: `${SHOTS}/planner-algorithm-light.png` });

    await page.getByRole("complementary", { name: "Resultados" }).getByRole("button", { expanded: false }).first().click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/planner-selected-light.png` });

    await setTheme(page, "dark");
    await page.reload();
    await expect(page.getByRole("button", { name: /^s001/ })).toBeVisible();
    await page.getByRole("button", { name: "Optimizar", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Resultado" })).toBeVisible();
    await settleMap(page);
    await page.screenshot({ path: `${SHOTS}/planner-solution-dark.png` });
  });

  test("estado de error", async ({ page }) => {
    await mockSolver(page, { failSolve: true });
    await setTheme(page, "light");
    await page.goto("/es/planner?demo=1");
    await expect(page.getByRole("button", { name: /^s001/ })).toBeVisible();
    await page.getByRole("button", { name: "Optimizar", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "No se pudo completar" })).toBeVisible();
    await settleMap(page);
    await page.screenshot({ path: `${SHOTS}/planner-error-light.png` });
  });
});

test.describe("móvil 390 px", () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });

  test("landing y planner con solución", async ({ page }) => {
    await mockSolver(page);
    await setTheme(page, "light");
    await page.goto("/es");
    await settleMap(page);
    await page.screenshot({ path: `${SHOTS}/mobile-landing.png` });

    await openDemoAndOptimize(page);
    await settleMap(page);
    await page.screenshot({ path: `${SHOTS}/mobile-planner-solution.png` });
  });
});
