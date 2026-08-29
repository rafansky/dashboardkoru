import { expect, test } from "@playwright/test";

const password = process.env.KORU_E2E_PASSWORD || "test-password";

async function openTactics(page, path = "/tactics") {
  const login = await page.request.post("/api/login", { multipart: { password } });
  expect(login.ok()).toBeTruthy();
  await page.route("**/api/dashboard", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ analytics: { playerElo: [] }, leaderboards: { scorers: [] }, upcoming: [], recent: [] }),
    });
  });
  await page.goto(path);
  await expect(page.locator("#pitch-shell svg")).toBeVisible();
}

test("desktop editor renders a usable tactical workspace", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await openTactics(page);

  await expect(page.locator("#roster-panel")).toBeVisible();
  await expect(page.locator("#properties-panel")).toBeVisible();
  await expect(page.locator("#scene-strip .scene-card")).toHaveCount(1);
  await expect(page.locator("#pitch-shell svg .perspective-band")).toHaveCount(10);

  const stage = await page.locator("#pitch-viewport").boundingBox();
  expect(stage?.width).toBeGreaterThan(600);
  expect(stage?.height).toBeGreaterThan(500);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("desktop.png"), fullPage: true });
});

test("mobile editor starts clear and opens one panel at a time", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await openTactics(page);

  await expect(page.locator("body")).toHaveClass(/left-collapsed/);
  await expect(page.locator("body")).toHaveClass(/right-collapsed/);
  await page.screenshot({ path: testInfo.outputPath("mobile-board.png"), fullPage: true });

  await page.getByRole("button", { name: "Mostrar u ocultar plantilla" }).click();
  await expect(page.locator("body")).not.toHaveClass(/left-collapsed/);
  await expect(page.locator("body")).toHaveClass(/right-collapsed/);

  await page.getByRole("button", { name: "Mostrar u ocultar propiedades" }).click();
  await expect(page.locator("body")).toHaveClass(/left-collapsed/);
  await expect(page.locator("body")).not.toHaveClass(/right-collapsed/);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("mobile-properties.png"), fullPage: true });
});

test("annotation rows select and arrows preview their drag", async ({ page }, testInfo) => {
  await page.route("**/api/tactical-boards/audit-annotation", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "audit-annotation",
        name: "Auditoria",
        category: "Ataque",
        version: 1,
        document: {
          schemaVersion: 3,
          pitch: { width: 105, height: 68, view: "full", orientation: "top-to-bottom", surface: "stripes", overlays: [] },
          teams: [],
          entities: [],
          scenes: [{
            id: "scene-1",
            name: "Escena base",
            duration: 3,
            transition: "ease-in-out",
            notes: "",
            entityStates: [],
            annotations: [{ id: "arrow-1", type: "arrow", start: { x: 20, y: 20 }, end: { x: 60, y: 40 }, color: "#f95516", text: "" }],
          }],
        },
      }),
    });
  });
  await openTactics(page, "/tactics?board=audit-annotation");

  const row = page.locator('[data-annotation-row="arrow-1"]');
  await row.locator("strong").click();
  await expect(row).toHaveClass(/active/);
  await expect(page.locator("#selection-section")).toBeVisible();
  await expect(page.locator("#selection-detail")).toContainText("Flecha");

  const arrow = page.locator(".tactical-arrow");
  const initialX = Number(await arrow.getAttribute("x1"));
  const strokeWidth = await arrow.evaluate((element) => Number.parseFloat(getComputedStyle(element).strokeWidth));
  expect(strokeWidth).toBeGreaterThanOrEqual(3.4);
  const dragPoint = await arrow.evaluate((element) => {
    const x1 = Number(element.getAttribute("x1"));
    const y1 = Number(element.getAttribute("y1"));
    const x2 = Number(element.getAttribute("x2"));
    const y2 = Number(element.getAttribute("y2"));
    const point = new DOMPoint(x1 + (x2 - x1) * 0.4, y1 + (y2 - y1) * 0.4).matrixTransform(element.getScreenCTM());
    return { x: point.x, y: point.y };
  });
  await page.mouse.move(dragPoint.x, dragPoint.y);
  await page.mouse.down();
  await page.mouse.move(dragPoint.x + 55, dragPoint.y + 25, { steps: 5 });
  await expect.poll(async () => Number(await arrow.getAttribute("x1"))).not.toBe(initialX);
  await page.screenshot({ path: testInfo.outputPath("arrow-drag-preview.png"), fullPage: true });
  await page.mouse.up();
});
