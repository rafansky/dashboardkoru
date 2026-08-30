import { expect, test } from "@playwright/test";

const password = process.env.KORU_E2E_PASSWORD || "test-password";

test("opponent profile is saved and can seed the current match plan", async ({ page }) => {
  const login = await page.request.post("/api/login", { multipart: { password } });
  expect(login.ok()).toBeTruthy();

  let savedProfile = null;
  await page.route("**/api/match-history", async (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([{
      matchId: "koru-rival-fc", opponent: "Rival FC", competition: "VPG Zero", matchDate: "2026-09-01T21:30:00Z",
      status: "pre-match", scoreFor: null, scoreAgainst: null, summary: "", takeaways: "", tags: [], lineup: [],
      boardCount: 0, sessionCount: 0, entryCount: 0, attachmentCount: 0, eventCount: 0, boards: [], sessions: [], attachments: [], events: [], matchPlan: null,
    }]),
  }));
  await page.route("**/api/opponent-profiles", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ contentType: "application/json", body: JSON.stringify(savedProfile ? [savedProfile] : []) });
    savedProfile = route.request().postDataJSON();
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(savedProfile) });
  });
  await page.goto("/match-history");
  await expect(page.getByText("Perfil acumulado del rival")).toBeVisible();

  await page.locator('[data-opponent-field="formation"]').fill("4-2-3-1");
  await page.locator('[data-opponent-field="playStyle"]').fill("Bloque medio y salida corta.");
  await page.locator('[data-opponent-field="weaknesses"]').fill("Espalda de los laterales.");
  await page.getByRole("button", { name: "Guardar perfil" }).click();
  await expect.poll(() => savedProfile?.formation).toBe("4-2-3-1");

  await page.getByRole("button", { name: "Usar en plan" }).click();
  await expect(page.locator('[data-plan-field="opponentProfile"]')).toHaveValue(/Sistema 4-2-3-1/);
  await expect(page.locator('[data-plan-field="threats"]')).toHaveValue(/Espalda de los laterales/);
});
