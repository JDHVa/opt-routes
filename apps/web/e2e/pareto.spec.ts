import { expect, test } from "@playwright/test";
import { computeFront, settleMap, SHOTS, setTheme } from "./helpers";
import { mockSolver } from "./mocks";

test.describe("pareto", () => {
  test("calcula el frente, selecciona un punto y muestra sus rutas", async ({ page }) => {
    const solver = await mockSolver(page);
    await computeFront(page);

    const request = solver.solveRequests[0] as { run: { algorithm: string } };
    expect(request.run.algorithm).toBe("nsga2");
    await expect(page.getByText("7 soluciones en el frente.")).toBeVisible();

    await expect(page.getByText("paradas. Selecciona una solución")).toBeVisible();
    await page.getByTestId("pareto-point").first().click({ force: true });
    await expect(page.getByRole("region", { name: "Solución seleccionada" })).toBeVisible();
    await expect(page.getByText("paradas. Selecciona una solución")).toHaveCount(0);

    const rows = page.locator("tbody tr");
    await expect(rows).toHaveCount(7);
    await expect(rows.filter({ has: page.locator('button[aria-pressed="true"]') })).toHaveCount(1);
  });

  test("cambia los ejes y recalcula los puntos dominados", async ({ page }) => {
    await mockSolver(page);
    await computeFront(page);
    await page.getByRole("combobox", { name: "Eje vertical" }).click();
    await page.getByRole("option", { name: "Vehículos" }).click();
    await expect(page.getByRole("combobox", { name: "Eje vertical" })).toContainText("Vehículos");
    await expect(page.getByTestId("pareto-point")).toHaveCount(7);
  });

  test("usa la solución seleccionada en el Planner", async ({ page }) => {
    await mockSolver(page);
    await computeFront(page);
    await page.getByRole("button", { name: "Seleccionar la solución 2" }).click();
    await page.getByRole("button", { name: "Usar esta solución en el Planner" }).click();
    await expect(page).toHaveURL(/\/es\/planner/);
    await expect(page.getByRole("heading", { name: "Resultado" })).toBeVisible();
  });

  test("capturas claro y oscuro", async ({ page }) => {
    await mockSolver(page);
    await setTheme(page, "light");
    await computeFront(page);
    await page.getByTestId("pareto-point").nth(2).click({ force: true });
    await settleMap(page);
    await page.screenshot({ path: `${SHOTS}/pareto-light.png` });
    await setTheme(page, "dark");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/pareto-dark.png` });
  });
});

test.describe("pareto en móvil", () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });

  test("captura móvil", async ({ page }) => {
    await mockSolver(page);
    await setTheme(page, "light");
    await computeFront(page);
    await page.getByTestId("pareto-point").nth(1).click({ force: true });
    await settleMap(page);
    await page.screenshot({ path: `${SHOTS}/mobile-pareto.png`, fullPage: true });
  });
});
