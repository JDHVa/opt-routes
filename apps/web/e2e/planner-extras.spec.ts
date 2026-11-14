import { expect, test, type Page } from "@playwright/test";
import { SHOTS, setTheme } from "./helpers";
import { mockSolver } from "./mocks";

async function openDemo(page: Page) {
  await page.goto("/es/planner?demo=1");
  await expect(page.getByRole("button", { name: /^s001/ })).toBeVisible();
}

test.describe("planner: CSV, generar, híbrido y exportar", () => {
  test("un CSV con errores muestra las filas y no reemplaza las paradas", async ({ page }) => {
    const solver = await mockSolver(page);
    await openDemo(page);
    await page.locator('input[type="file"]').setInputFiles({
      name: "paradas.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("bad,csv"),
    });
    const alert = page.getByRole("alert").filter({ hasText: "El CSV tiene errores" });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("lat fuera de rango");
    await expect(alert).toContainText("falta la columna lon");
    expect(solver.importRequests[0]).toEqual({ text: "bad,csv" });
    await expect(page.getByRole("button", { name: /^s001/ })).toBeVisible();
    await alert.getByRole("button", { name: "Descartar errores" }).click();
    await expect(alert).toHaveCount(0);
  });

  test("un CSV válido reemplaza las paradas del problema actual", async ({ page }) => {
    await mockSolver(page);
    await openDemo(page);
    await page.locator('input[type="file"]').setInputFiles({
      name: "paradas.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("id,lat,lon\ns1,25.6,-100.3"),
    });
    await expect(
      page.getByRole("complementary", { name: "Configuración del problema" }).getByRole("heading", { level: 3 }),
    ).toContainText("5");
  });

  test("generar aleatorias envía los parámetros del diálogo", async ({ page }) => {
    const solver = await mockSolver(page);
    await openDemo(page);
    await page.getByRole("button", { name: "Generar aleatorias" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Generar paradas aleatorias" })).toBeVisible();
    await dialog.getByLabel("Paradas").fill("25");
    await dialog.getByLabel("Repartidores").fill("3");
    await dialog.getByLabel("Pedidos dinámicos").fill("20");
    await dialog.getByLabel("Semilla").fill("9");
    await dialog.getByRole("button", { name: "Multi-origen" }).click();
    await dialog.getByRole("button", { name: "Generar escenario" }).click();
    await expect(dialog).toHaveCount(0);
    expect(solver.generateRequests[0]).toEqual({
      n_stops: 25,
      n_drivers: 3,
      mode: "multi_origin",
      time_windows_pct: 0.3,
      high_priority_pct: 0.1,
      dynamic_pct: 0.2,
      seed: 9,
    });
  });

  test("valida el diálogo de generación en vivo", async ({ page }) => {
    await mockSolver(page);
    await openDemo(page);
    await page.getByRole("button", { name: "Generar aleatorias" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Paradas").fill("900");
    await expect(dialog.getByText("Debe ser como máximo 250.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Generar escenario" })).toBeDisabled();
  });

  test("el híbrido muestra las mejoras aportadas y se exporta CSV y JSON", async ({ page }) => {
    const solver = await mockSolver(page);
    await openDemo(page);
    await page.getByRole("tab", { name: "Algoritmo" }).click();
    await page.getByLabel("Método de optimización").click();
    await page.getByRole("option", { name: "ACO+GA" }).click();
    await page.getByRole("button", { name: "Optimizar", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Resultado" })).toBeVisible();

    const panel = page.getByRole("complementary", { name: "Resultados" });
    await expect(panel.getByText("Mejoras aportadas")).toBeVisible();
    await expect(panel.getByRole("img", { name: "Mejoras aportadas: GA 7, ACO 3" })).toBeVisible();

    const csvDownload = page.waitForEvent("download");
    await panel.getByRole("button", { name: "Exportar CSV" }).click();
    expect((await csvDownload).suggestedFilename()).toBe("routeopt-itinerary.csv");
    expect(solver.exportRequests).toHaveLength(1);

    const jsonDownload = page.waitForEvent("download");
    await panel.getByRole("button", { name: "Exportar JSON" }).click();
    expect((await jsonDownload).suggestedFilename()).toBe("routeopt-solution.json");
  });

  test("capturas del diálogo y del panel de errores CSV", async ({ page }) => {
    await mockSolver(page);
    await setTheme(page, "light");
    await openDemo(page);
    await page.locator('input[type="file"]').setInputFiles({
      name: "paradas.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("bad,csv"),
    });
    await expect(page.getByRole("alert").filter({ hasText: "El CSV tiene errores" })).toBeVisible();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/planner-csv-errors-light.png` });
    await page.getByRole("button", { name: "Generar aleatorias" }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/planner-generate-dialog-light.png` });
  });
});
