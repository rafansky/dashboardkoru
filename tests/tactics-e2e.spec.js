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

function threeDAuditBoard() {
  const entities = [
    { id: "home-1", type: "player", teamId: "home", name: "Ricky", number: 10, position: { x: 22, y: 34, z: 0 }, rotation: 90, scale: 1, opacity: 1, locked: false, visible: true, metadata: { avatarUrl: "https://vpg-prod-user-uploads.fra1.cdn.digitaloceanspaces.com/avatars/ricky.webp" } },
    { id: "home-2", type: "player", teamId: "home", name: "Pedro", number: 3, position: { x: 48, y: 22, z: 0 }, rotation: 90, scale: 1, opacity: 1, locked: false, visible: true, metadata: {} },
    { id: "away-1", type: "player", teamId: "away", name: "Rival", number: 9, position: { x: 76, y: 42, z: 0 }, rotation: 270, scale: 1, opacity: 1, locked: false, visible: true, metadata: {} },
    { id: "ball-1", type: "ball", teamId: null, name: "Balon", number: null, position: { x: 52.5, y: 34, z: 0 }, rotation: 0, scale: 1, opacity: 1, locked: false, visible: true, metadata: {} },
  ];
  const annotations = [
    { id: "arrow-3d", type: "arrow", start: { x: 24, y: 34 }, end: { x: 50, y: 26 }, color: "#f95516", text: "" },
    { id: "zone-3d", type: "zone", start: { x: 62, y: 15 }, end: { x: 82, y: 32 }, color: "#12d6df", text: "" },
  ];
  return {
    id: "audit-3d",
    name: "Auditoria 3D",
    category: "Ataque",
    version: 1,
    document: {
      schemaVersion: 4,
      pitch: { width: 105, height: 68, view: "full", orientation: "top-to-bottom", surface: "stripes", overlays: ["thirds"] },
      teams: [
        { id: "home", name: "KORU eClub", primaryColor: "#f7f8fb", secondaryColor: "#f95516" },
        { id: "away", name: "Rival", primaryColor: "#12d6df", secondaryColor: "#101217" },
      ],
      entities,
      settings: { showNames: true, anonymizePlayers: false },
      timeline: { mode: "scenes", loop: false, speed: 8 },
      scenes: [
        { id: "scene-3d-1", name: "Base", duration: 0.5, transition: "linear", notes: "", entityStates: entities.map((entity) => ({ entityId: entity.id, position: entity.position, rotation: entity.rotation, scale: 1, opacity: 1 })), annotations, movementPaths: [{ id: "path-3d", entityId: "home-2", color: "#f95516", points: [{ x: 48, y: 22, z: 0 }, { x: 61, y: 18, z: 0 }, { x: 73, y: 23, z: 0 }] }] },
        { id: "scene-3d-2", name: "Ataque", duration: 0.5, transition: "linear", notes: "", entityStates: entities.map((entity) => ({ entityId: entity.id, position: entity.id === "home-1" ? { x: 58, y: 31, z: 0 } : entity.position, rotation: entity.rotation, scale: 1, opacity: 1 })), annotations, movementPaths: [] },
      ],
    },
  };
}

async function canvasPixelStats(canvas) {
  await canvas.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return canvas.evaluate((element) => {
    const gl = element.getContext("webgl2") || element.getContext("webgl");
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let colored = 0;
    let bright = 0;
    let hash = 17;
    let sampled = 0;
    for (let index = 0; index < pixels.length; index += 64) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      if (green > red * 1.15 && green > blue * 1.12 && green > 35) colored += 1;
      if (red + green + blue > 420) bright += 1;
      hash = (hash * 33 + red * 3 + green * 5 + blue * 7 + index) % 2147483647;
      sampled += 1;
    }
    return { width, height, colored, bright, sampled, hash };
  });
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

test("3D view mirrors the tactical document and supports camera interaction", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  let avatarLoads = 0;
  await page.route("**/api/tactical-avatar**", async (route) => {
    avatarLoads += 1;
    await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#14b8a6"/><circle cx="40" cy="30" r="18" fill="#f4c7a1"/></svg>' });
  });
  await page.route("**/api/tactical-boards/audit-3d", async (route) => {
    const board = route.request().method() === "PUT"
      ? { ...threeDAuditBoard(), ...route.request().postDataJSON(), id: "audit-3d", version: 2 }
      : threeDAuditBoard();
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(board) });
  });
  await openTactics(page, "/tactics?board=audit-3d");
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await expect.poll(() => avatarLoads).toBeGreaterThan(0);

  const canvas = page.locator("#pitch-3d-layer canvas");
  await expect(canvas).toBeVisible();
  await expect(page.locator("#pitch-2d-layer")).toBeHidden();
  const before = await canvasPixelStats(canvas);
  expect(before.width).toBeGreaterThan(900);
  expect(before.height).toBeGreaterThan(600);
  expect(before.colored).toBeGreaterThan(before.sampled * 0.08);
  expect(before.bright).toBeGreaterThan(20);
  await page.screenshot({ path: testInfo.outputPath("tactics-3d-desktop.png"), fullPage: true });

  await page.getByRole("button", { name: "2D", exact: true }).click();
  const beforeMove = await page.locator('[data-entity-id="home-1"]').getAttribute("transform");
  await page.getByRole("button", { name: "3D", exact: true }).click();
  const canvasBounds = await canvas.boundingBox();
  await page.mouse.move(canvasBounds.x + canvasBounds.width * 0.5, canvasBounds.y + canvasBounds.height * 0.296);
  await page.mouse.down();
  await page.mouse.move(canvasBounds.x + canvasBounds.width * 0.55, canvasBounds.y + canvasBounds.height * 0.31, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "2D", exact: true }).click();
  await expect.poll(async () => page.locator('[data-entity-id="home-1"]').getAttribute("transform")).not.toBe(beforeMove);
  await page.getByRole("button", { name: "3D", exact: true }).click();

  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * 0.55, bounds.y + bounds.height * 0.52);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.68, bounds.y + bounds.height * 0.45, { steps: 8 });
  await page.mouse.up();
  const afterCamera = await canvasPixelStats(canvas);
  expect(afterCamera.hash).not.toBe(before.hash);

  await page.getByRole("button", { name: "2D", exact: true }).click();
  await expect(page.locator('[data-entity-id="home-1"]')).toBeVisible();
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await page.getByRole("button", { name: "Encajar campo" }).click();
  await page.getByRole("button", { name: "Reproducir siguiente movimiento" }).click();
  await expect.poll(async () => (await page.locator("#scene-counter").textContent())?.trim()).toBe("2 de 2");
  const afterScene = await canvasPixelStats(canvas);
  expect(afterScene.hash).not.toBe(afterCamera.hash);
});

test("3D view remains nonblank and framed on mobile", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/tactical-boards/audit-3d", async (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(threeDAuditBoard()) }));
  await openTactics(page, "/tactics?board=audit-3d");
  await page.getByRole("button", { name: "3D", exact: true }).click();
  const canvas = page.locator("#pitch-3d-layer canvas");
  await expect(canvas).toBeVisible();
  const bounds = await canvas.boundingBox();
  expect(bounds.width).toBeGreaterThan(340);
  expect(bounds.height).toBeGreaterThan(580);
  const stats = await canvasPixelStats(canvas);
  expect(stats.colored).toBeGreaterThan(stats.sampled * 0.05);
  await page.screenshot({ path: testInfo.outputPath("tactics-3d-mobile.png"), fullPage: true });
});

test("public viewer follows live 3D presentation and the editor exports the sequence", async ({ page }) => {
  test.setTimeout(60_000);
  const login = await page.request.post("/api/login", { multipart: { password } });
  expect(login.ok()).toBeTruthy();
  const source = threeDAuditBoard();
  source.document.timeline.speed = 2;
  const { id: _id, version: _version, ...payload } = source;
  const created = await page.request.post("/api/tactical-boards", { data: payload });
  expect(created.ok()).toBeTruthy();
  const savedBoard = await created.json();
  const shared = await page.request.post(`/api/tactical-boards/${savedBoard.id}/share`);
  expect(shared.ok()).toBeTruthy();
  const share = await shared.json();

  await page.context().route("**/api/tactical-avatar**", async (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#14b8a6"/></svg>',
  }));
  const viewer = await page.context().newPage();
  await viewer.goto(share.url);
  await expect(viewer.locator("#viewer-pitch-2d svg")).toBeVisible();

  await page.route("**/api/dashboard", async (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ analytics: { playerElo: [] }, leaderboards: { scorers: [] }, upcoming: [], recent: [] }),
  }));
  await page.goto(`/tactics?board=${savedBoard.id}`);
  await expect(page.locator("#pitch-shell svg")).toBeVisible();
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await expect(viewer.locator("#viewer-pitch-3d canvas")).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Siguiendo" })).toHaveAttribute("aria-pressed", "true");

  const capture = viewer.waitForEvent("download");
  await viewer.getByRole("button", { name: "Captura" }).click();
  expect((await capture).suggestedFilename()).toMatch(/\.png$/);

  const recording = page.waitForEvent("download", { timeout: 20_000 });
  await page.getByRole("button", { name: "Grabar secuencia tactica" }).click();
  expect((await recording).suggestedFilename()).toMatch(/-secuencia\.(webm|mp4|json)$/);
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
  await expect(page.locator('[data-entity-id="player-1"]')).toHaveClass(/selected/);
  await expect(page.locator('[data-entity-id="player-1"] .selection-ring')).toHaveCSS("animation-name", "selection-ring-pulse");
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
