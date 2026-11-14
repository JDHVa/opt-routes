import { expect, type Page } from "@playwright/test";

export const SHOTS = "test-results/screenshots";
export const MAP_SETTLE_MS = 3500;

export async function setTheme(page: Page, theme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: theme });
}

export async function settleMap(page: Page) {
  await page.locator("canvas.maplibregl-canvas").first().waitFor({ state: "visible" });
  await page.waitForTimeout(MAP_SETTLE_MS);
}

export async function runCompare(page: Page) {
  await page.goto("/es/compare");
  await page.getByRole("button", { name: "Comparar 5 corridas" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(5);
  await expect(page.getByText("En curso")).toHaveCount(0);
  await expect(page.getByText("En espera")).toHaveCount(0);
}

export async function computeFront(page: Page) {
  await page.goto("/es/pareto");
  await page.getByRole("button", { name: "Cargar demo Monterrey" }).click();
  await page.getByRole("button", { name: "Calcular frente" }).click();
  await expect(page.getByTestId("pareto-point")).toHaveCount(7);
}

export async function startSimulation(page: Page) {
  await page.goto("/es/simulate");
  const start = page.getByRole("button", { name: "Iniciar simulación" });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.getByTestId("sim-driver")).toHaveCount(2);
}
