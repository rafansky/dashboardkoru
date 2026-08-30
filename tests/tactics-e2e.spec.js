import { expect, test } from "@playwright/test";

const password = process.env.KORU_E2E_PASSWORD || "test-password";

async function openTactics(page, path = "/tactics", options = {}) {
  const login = await page.request.post("/api/login", { multipart: { password } });
  expect(login.ok()).toBeTruthy();
  if (options.mockBoards !== false) {
    await page.route("**/api/tactical-boards?search=", async (route) => {
      await route.fulfill({ contentType: "application/json", body: "[]" });
    });
  }
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

  const viewport = page.locator("#pitch-viewport");
  const viewportBox = await viewport.boundingBox();
  const dragStart = { x: viewportBox.x + viewportBox.width * 0.72, y: viewportBox.y + viewportBox.height * 0.38 };
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragStart.x + 3, dragStart.y + 3);
  await expect(page.locator("#selection-marquee")).toBeHidden();
  await page.mouse.move(dragStart.x + 90, dragStart.y + 60);
  await expect(page.locator("#selection-marquee")).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(new Event("fullscreenchange")));
  await expect(page.locator("#selection-marquee")).toBeHidden();
  await page.mouse.up();

  await page.getByRole("button", { name: "Abrir modo presentacion" }).click();
  await expect(page.locator("body")).toHaveClass(/presentation-mode/);
  await expect(page.locator("#presentation-dock")).toBeVisible();
  await page.getByRole("button", { name: "Mostrar anotaciones" }).click();
  await expect(page.locator("#pitch-shell svg")).toHaveAttribute("data-show-annotations", "false");
  await page.screenshot({ path: testInfo.outputPath("presentation-mode.png"), fullPage: true });
  await page.getByRole("button", { name: "Salir de modo presentacion" }).click();
  await expect(page.locator("body")).not.toHaveClass(/presentation-mode/);

  const stage = await page.locator("#pitch-viewport").boundingBox();
  expect(stage?.width).toBeGreaterThan(600);
  expect(stage?.height).toBeGreaterThan(500);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("desktop.png"), fullPage: true });
});

test("base tactics route restores the most recent saved board", async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("koru:tactics:last-board:v1"));
  await page.route("**/api/tactical-boards?search=", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{ id: "latest-board", name: "Ultima pizarra", updated_at: "2026-08-30T12:00:00Z" }]),
    });
  });
  await page.route("**/api/tactical-boards/latest-board", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "latest-board",
        name: "Ultima pizarra",
        category: "Ataque",
        version: 1,
        document: {
          schemaVersion: 3,
          pitch: { width: 105, height: 68, view: "full", orientation: "top-to-bottom", surface: "stripes", overlays: [] },
          teams: [],
          entities: [{ id: "saved-player", type: "player", teamId: "home", name: "Ricky", number: 10, position: { x: 30, y: 30, z: 0 }, rotation: 90, scale: 1, opacity: 1, locked: false, visible: true, metadata: {} }],
          scenes: [{ id: "scene-1", name: "Escena base", duration: 3, transition: "ease-in-out", notes: "", entityStates: [], annotations: [] }],
        },
      }),
    });
  });
  await openTactics(page, "/tactics", { mockBoards: false });
  await expect(page.locator("#board-name")).toHaveValue("Ultima pizarra");
  await expect(page.locator('[data-entity-id="saved-player"]')).toBeVisible();
  await expect(page).toHaveURL(/board=latest-board/);
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
          entities: [{ id: "player-1", type: "player", teamId: "home", name: "Ricky", number: 10, position: { x: 30, y: 30, z: 0 }, rotation: 90, scale: 1, opacity: 1, locked: false, visible: true, metadata: {} }],
          scenes: [{
            id: "scene-1",
            name: "Escena base",
            duration: 3,
            transition: "ease-in-out",
            notes: "",
            entityStates: [],
            annotations: [
              { id: "arrow-1", type: "arrow", start: { x: 20, y: 20 }, end: { x: 60, y: 40 }, color: "#f95516", text: "" },
              { id: "zone-1", type: "zone", start: { x: 65, y: 18 }, end: { x: 85, y: 42 }, color: "#12d6df", text: "" },
            ],
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

  await page.getByRole("button", { name: "Flecha" }).click();
  const drawBox = await page.locator("#pitch-shell svg").boundingBox();
  expect(drawBox).not.toBeNull();
  await page.mouse.move(drawBox.x + drawBox.width * 0.28, drawBox.y + drawBox.height * 0.72);
  await page.mouse.down();
  await page.mouse.move(drawBox.x + drawBox.width * 0.5, drawBox.y + drawBox.height * 0.48, { steps: 6 });
  await expect(page.locator('[data-annotation-id="draft-annotation"] .tactical-arrow')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator(".tactical-arrow")).toHaveCount(2);
  await page.getByRole("button", { name: "Seleccion" }).click();
  await page.locator(".tactical-arrow").last().click();
  await page.keyboard.press("Delete");
  await expect(page.locator(".tactical-arrow")).toHaveCount(1);

  await page.locator('[data-annotation-row="arrow-1"] strong').click();
  await page.locator('[data-annotation-row="zone-1"] strong').click({ modifiers: ["Control"] });
  await expect(page.locator(".tactical-annotation-item.selected")).toHaveCount(2);
  await page.keyboard.press("Delete");
  await expect(page.locator(".tactical-annotation-item")).toHaveCount(0);
  await expect(page.locator('[data-entity-id="player-1"]')).toBeVisible();

  await page.locator('[data-entity-id="player-1"]').click();
  await page.getByRole("button", { name: "Trayectoria" }).click();
  const svgBox = await page.locator("#pitch-shell svg").boundingBox();
  expect(svgBox).not.toBeNull();
  await page.mouse.click(svgBox.x + svgBox.width * 0.56, svgBox.y + svgBox.height * 0.54);
  await expect(page.locator("#path-draft-controls")).toBeVisible();
  await page.mouse.click(svgBox.x + svgBox.width * 0.68, svgBox.y + svgBox.height * 0.66);
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.locator(".movement-path-line")).toHaveCount(1);
  await expect(page.locator("#path-list .path-row")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("movement-path.png"), fullPage: true });
  await page.getByRole("button", { name: "Crear grafica de alineacion" }).click();
  await expect(page.locator("#lineup-graphic-dialog")).toBeVisible();
  await expect(page.locator("#graphic-lineup-count")).toContainText("jugadores KORU");
  await page.locator("#graphic-opponent").fill("Rival FC");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar PNG" }).click();
  expect((await download).suggestedFilename()).toMatch(/alineacion\.(png|svg)$/);
});
