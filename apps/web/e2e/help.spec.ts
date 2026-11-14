import { expect, test } from "@playwright/test";
import { settleMap, SHOTS, setTheme } from "./helpers";
import { mockSolver } from "./mocks";

test.describe("ayuda contextual", () => {
  test("el InfoTip de una métrica se abre con hover y se describe a lectores", async ({ page }) => {
    await mockSolver(page);
    await setTheme(page, "light");
    await page.goto("/es/planner?demo=1");
    await expect(page.getByRole("button", { name: /^s001/ })).toBeVisible();
    await page.getByRole("button", { name: "Optimizar", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Resultado" })).toBeVisible();
    await settleMap(page);

    const tip = page.getByRole("button", { name: "Más información: Última entrega" });
    await expect(tip).toHaveAttribute("aria-describedby", /.+/);
    await tip.hover();
    const popup = page.locator('[data-slot="info-tip-content"]');
    await expect(popup).toBeVisible();
    await expect(popup).toContainText("ruta más larga");
    await page.screenshot({ path: `${SHOTS}/planner-infotip-light.png` });
    await page.mouse.move(10, 400);
    await expect(popup).toHaveCount(0);
  });

  test("el InfoTip de un parámetro se abre con el teclado", async ({ page }) => {
    await mockSolver(page);
    await page.goto("/es/planner?demo=1");
    await expect(page.getByRole("button", { name: /^s001/ })).toBeVisible();
    await page.getByRole("tab", { name: "Algoritmo" }).click();
    const tip = page.getByRole("button", { name: "Más información: Tiempo límite" });
    await tip.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-slot="info-tip-content"]')).toContainText("Segundos máximos");
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-slot="info-tip-content"]')).toHaveCount(0);
  });

  test("cada parámetro del formulario tiene su InfoTip", async ({ page }) => {
    await mockSolver(page);
    await page.goto("/es/planner?demo=1");
    await expect(page.getByRole("button", { name: /^s001/ })).toBeVisible();
    await page.getByRole("tab", { name: "Algoritmo" }).click();
    await page.getByRole("button", { name: "Avanzado" }).click();
    const labels = await page.locator("label").count();
    const tips = await page.getByRole("button", { name: /^Más información:/ }).count();
    expect(tips).toBeGreaterThanOrEqual(labels - 2);
  });

  test("el glosario aparece en la paleta de comandos", async ({ page }) => {
    await mockSolver(page);
    await page.goto("/es/planner");
    await expect(async () => {
      await page.keyboard.press("Control+k");
      await expect(page.getByRole("option", { name: /¿Qué es Split\?/ })).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await page.keyboard.type("feromona");
    await expect(page.getByRole("option", { name: /¿Qué es Feromona\?/ })).toBeVisible();
  });

  test("el recorrido de bienvenida se muestra una vez y se recuerda", async ({ page }) => {
    await mockSolver(page, { coach: true });
    await page.goto("/es/planner");
    const tour = page.getByRole("dialog", { name: "Recorrido de bienvenida" });
    await expect(tour).toBeVisible({ timeout: 10_000 });
    await expect(tour).toContainText("Paso 1 de 4");
    await tour.getByRole("button", { name: "Siguiente" }).click();
    await expect(tour).toContainText("Paso 2 de 4");
    await page.screenshot({ path: `${SHOTS}/planner-coach-light.png` });
    await tour.getByRole("button", { name: "Omitir recorrido" }).click();
    await expect(tour).toHaveCount(0);
    await page.reload();
    await page.waitForTimeout(1800);
    await expect(page.getByRole("dialog", { name: "Recorrido de bienvenida" })).toHaveCount(0);
  });
});
