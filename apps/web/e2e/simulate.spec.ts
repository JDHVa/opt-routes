import { expect, test } from "@playwright/test";
import { settleMap, SHOTS, setTheme, startSimulation } from "./helpers";
import { mockSolver } from "./mocks";
import { mockSimulation } from "./sim-mock";

async function clickMapCenter(page: import("@playwright/test").Page) {
  const box = await page.locator("canvas.maplibregl-canvas").first().boundingBox();
  if (!box) throw new Error("mapa sin caja");
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.4);
}

test.describe("simulación", () => {
  test("arranca, avanza el reloj, registra eventos y muestra el resumen", async ({ page }) => {
    await mockSolver(page);
    const sim = await mockSimulation(page);
    await startSimulation(page);

    expect(sim.received.find((m) => m.type === "start")).toMatchObject({
      config: { speed: 60, trigger: "event", run: { algorithm: "ga" } },
    });

    await expect(page.getByTestId("sim-log")).toContainText("Plan inicial");
    await expect(page.getByTestId("sim-clock")).not.toHaveText("08:00");
    await expect(page.getByTestId("mark-order")).not.toHaveCount(0);
    await expect(page.getByTestId("mark-reopt")).not.toHaveCount(0);
    await expect(page.getByTestId("sim-log")).toContainText("Pedido nuevo s900");
    await expect(page.getByTestId("sim-log")).toContainText("Re-optimización por pedido");

    await expect(page.getByTestId("sim-summary")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Resumen de la jornada" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Nueva simulación" })).toBeVisible();
  });

  test("envía velocidad, pausa y reanudación por el WebSocket", async ({ page }) => {
    await mockSolver(page);
    const sim = await mockSimulation(page);
    await startSimulation(page);

    await page.getByRole("button", { name: "120×" }).click();
    await page.getByRole("button", { name: "Pausar" }).click();
    await expect(page.getByRole("button", { name: "Reanudar" })).toBeVisible();
    await page.getByRole("button", { name: "Reanudar" }).click();

    const types = sim.received.map((m) => m.type);
    expect(types).toContain("pause");
    expect(types).toContain("resume");
    expect(sim.received.find((m) => m.type === "speed")).toMatchObject({ speed: 120 });
  });

  test("agregar pedido: el clic en el mapa envía add_order", async ({ page }) => {
    await mockSolver(page);
    const sim = await mockSimulation(page);
    await startSimulation(page);

    await page.getByRole("button", { name: "Agregar pedido" }).click();
    await expect(page.getByText("Haz clic en el mapa para colocar el pedido")).toBeVisible();
    await clickMapCenter(page);

    await expect(page.getByTestId("sim-log")).toContainText("Pedido nuevo u001");
    expect(sim.received.find((m) => m.type === "add_order")).toMatchObject({
      stop: {
        id: "u001",
        release_min: expect.any(Number),
        location: { lat: expect.any(Number), lon: expect.any(Number) },
      },
    });
    await expect(page.getByText("Haz clic en el mapa para colocar el pedido")).toHaveCount(0);
  });

  test("los pedidos nuevos hacen un pulso breve", async ({ page }) => {
    await mockSolver(page);
    await mockSimulation(page);
    await startSimulation(page);
    await page.waitForSelector('[data-testid="order-pulse"]', { state: "attached", timeout: 15_000 });
    await expect(page.getByTestId("order-pulse")).toHaveCount(0, { timeout: 3000 });
  });

  test("con prefers-reduced-motion no hay pulso", async ({ page }) => {
    await mockSolver(page);
    await mockSimulation(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await startSimulation(page);
    await expect(page.getByTestId("mark-order")).not.toHaveCount(0);
    await expect(page.getByTestId("order-pulse")).toHaveCount(0);
  });

  test("un cierre inesperado ofrece reconectar", async ({ page }) => {
    await mockSolver(page);
    await page.routeWebSocket("**/simulate", (ws) => {
      ws.onMessage(() => ws.close({ code: 1011, reason: "boom" }));
    });
    await page.goto("/es/simulate");
    const start = page.getByRole("button", { name: "Iniciar simulación" });
    await expect(start).toBeEnabled();
    await start.click();
    await expect(page.getByRole("alert").filter({ hasText: "La simulación se detuvo" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reconectar e iniciar de nuevo" })).toBeVisible();
  });

  test("capturas claro y oscuro", async ({ page }) => {
    await mockSolver(page);
    await mockSimulation(page);
    await setTheme(page, "light");
    await startSimulation(page);
    await expect(page.getByTestId("mark-reopt")).not.toHaveCount(0);
    await settleMap(page);
    await page.screenshot({ path: `${SHOTS}/simulate-light.png` });
    await expect(page.getByTestId("sim-summary")).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: `${SHOTS}/simulate-done-light.png` });
    await setTheme(page, "dark");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/simulate-done-dark.png` });
  });
});

test.describe("simulación en móvil", () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });

  test("captura móvil", async ({ page }) => {
    await mockSolver(page);
    await mockSimulation(page);
    await setTheme(page, "light");
    await startSimulation(page);
    await expect(page.getByTestId("mark-reopt")).not.toHaveCount(0);
    await settleMap(page);
    await page.screenshot({ path: `${SHOTS}/mobile-simulate.png` });
  });
});
