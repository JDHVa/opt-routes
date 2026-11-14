import { expect, test } from "@playwright/test";
import { runCompare, settleMap, SHOTS, setTheme } from "./helpers";
import { mockSolver } from "./mocks";

test.describe("comparar", () => {
  test("corre las cinco corridas por defecto, ordena y marca las mejores celdas", async ({ page }) => {
    const solver = await mockSolver(page);
    await runCompare(page);

    const body = solver.compareRequests[0] as { runs: { algorithm: string }[] };
    expect(body.runs.map((run) => run.algorithm)).toEqual([
      "ga",
      "aco",
      "aco_ga",
      "pyvrp",
      "ortools",
    ]);

    const rows = page.locator("tbody tr");
    const gaRow = rows.filter({ hasText: /^GA/ });
    await expect(gaRow.locator("td").nth(1)).toHaveClass(/text-success/);
    await expect(gaRow.locator("td").nth(1)).toHaveClass(/font-semibold/);
    await expect(rows.nth(1).locator("td").nth(1)).not.toHaveClass(/text-success/);
    await expect(gaRow.locator("td").nth(6)).toContainText("0.0 %");

    await expect(rows.filter({ hasText: /^ACO\+GA/ }).getByText("No")).toBeVisible();

    const costHeader = page.getByRole("columnheader", { name: /Costo/ });
    await costHeader.getByRole("button").click();
    await expect(costHeader).toHaveAttribute("aria-sort", "ascending");
    await costHeader.getByRole("button").click();
    await expect(costHeader).toHaveAttribute("aria-sort", "descending");
    await expect(rows.first()).toContainText("OR-Tools");

    await expect(page.getByRole("img", { name: /Curvas de convergencia/ })).toBeVisible();
  });

  test("los minimapas son opcionales y se pueden sincronizar", async ({ page }) => {
    await mockSolver(page);
    await runCompare(page);
    await expect(page.getByText("Sincronizar los mapas")).toHaveCount(0);
    await page.getByRole("switch", { name: "Mostrar minimapas" }).click();
    await expect(page.getByText("Sincronizar los mapas")).toBeVisible();
    await expect(page.locator("canvas.maplibregl-canvas")).toHaveCount(5);
  });

  test("permite quitar corridas hasta el mínimo y añadir de nuevo", async ({ page }) => {
    const solver = await mockSolver(page);
    await page.goto("/es/compare");
    await expect(page.getByRole("button", { name: "Comparar 5 corridas" })).toBeVisible();
    for (const n of [5, 4, 3]) {
      await page.getByRole("button", { name: `Quitar la corrida ${n}` }).click();
    }
    await expect(page.getByRole("button", { name: "Quitar la corrida 2" })).toBeDisabled();
    await page.getByRole("button", { name: "Añadir corrida" }).click();
    await page.getByRole("button", { name: "Comparar 3 corridas" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(3);
    expect((solver.compareRequests[0] as { runs: unknown[] }).runs).toHaveLength(3);
  });

  test("capturas claro y oscuro", async ({ page }) => {
    await mockSolver(page);
    await setTheme(page, "light");
    await runCompare(page);
    await page.getByRole("switch", { name: "Mostrar minimapas" }).click();
    await settleMap(page);
    await page.screenshot({ path: `${SHOTS}/compare-light.png`, fullPage: true });
    await setTheme(page, "dark");
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/compare-dark.png`, fullPage: true });
  });
});

test.describe("comparar en móvil", () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });

  test("captura móvil", async ({ page }) => {
    await mockSolver(page);
    await setTheme(page, "light");
    await runCompare(page);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/mobile-compare.png`, fullPage: true });
  });
});
