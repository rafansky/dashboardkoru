import { test, expect } from "@playwright/test";

test("desktop captain issues link, player votes anonymously, ballot updates, close freezes results", async ({ page, browser }) => {
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.request.post("/api/login",{data:new URLSearchParams({password:process.env.KORU_E2E_PASSWORD||"test-password"}).toString(),headers:{"Content-Type":"application/x-www-form-urlencoded"}});
  await page.goto("/potw");
  await expect(page.getByText("Votación abierta",{exact:true})).toBeVisible();
  await expect(page.locator(".award.first h2")).toHaveText("Jugador 1");
  await page.getByRole("button",{name:"Ver partidos"}).first().click();
  await expect(page.locator(".row-detail:not([hidden]) .game")).toHaveCount(4);
  await page.getByText("Área del capitán",{exact:false}).click();
  await page.locator("#manager-key").fill(process.env.KORU_POTW_MANAGER_KEY||"e2e-captain-key");
  await page.getByRole("button",{name:"Acceder",exact:true}).click();
  await expect(page.locator(".voter")).toHaveCount(4);
  await page.locator('[data-issue="1"]').click();
  const link=await page.locator("#link-1 input").inputValue();
  const context=await browser.newContext();
  const ballot=await context.newPage();
  await ballot.goto(link);
  await expect(ballot.getByRole("heading",{name:"Tu papeleta, Jugador 1"})).toBeVisible();
  await expect(ballot.locator('select[name="rank0"] option[value="1"]')).toHaveCount(0);
  await ballot.locator('[name="rank0"]').selectOption("2");
  await expect(ballot.locator('[name="rank1"] option[value="2"]')).toHaveAttribute("disabled", "");
  await ballot.locator('[name="rank1"]').selectOption("3");
  await ballot.locator('[name="rank2"]').selectOption("4");
  await ballot.getByRole("button",{name:"Guardar mi voto"}).click();
  await expect(ballot.locator("#ballot-status")).toContainText("Voto guardado");
  await ballot.reload();
  await expect(ballot.locator('[name="rank0"]')).toHaveValue("2");
  // Clear selected ranks before reversing them to respect disabled duplicates.
  await ballot.locator('[name="rank0"]').selectOption("");
  await ballot.locator('[name="rank2"]').selectOption("2");
  await ballot.locator('[name="rank0"]').selectOption("4");
  await ballot.getByRole("button",{name:"Actualizar mi voto"}).click();
  await expect(ballot.locator("#notice")).toContainText("guardado");
  await page.reload();
  await expect(page.locator(".statusbar")).toContainText("1/4 papeletas");
  await expect(page.locator("tbody tr:not(.row-detail)").first()).toContainText("Ocultos");
  await page.getByText("Área del capitán",{exact:false}).click();
  await page.locator("#manager-key").fill(process.env.KORU_POTW_MANAGER_KEY||"e2e-captain-key");
  await page.getByRole("button",{name:"Acceder",exact:true}).click();
  page.once("dialog",dialog=>dialog.accept());
  await page.getByRole("button",{name:"Cerrar votación ahora"}).click();
  await expect(page.getByText("Premio definitivo",{exact:true})).toBeVisible();
  await expect(page.locator(".statusbar")).toContainText("Sin cuórum");
  await ballot.reload();
  await expect(ballot.getByText("La votación ha terminado.",{exact:false})).toBeVisible();
  await expect(ballot.getByRole("button",{name:"Actualizar mi voto"})).toHaveCount(0);
  await expect(page.locator(".award.first h2")).toHaveText("Jugador 1");
  expect(errors).toEqual([]);
  await context.close();
});

test("mobile week navigation, detail and layout fit a narrow screen", async ({ page }) => {
  await page.setViewportSize({width:375,height:812});
  await page.request.post("/api/login",{multipart:{password:process.env.KORU_E2E_PASSWORD||"test-password"}});
  await page.goto("/potw");
  await expect(page.locator(".award.first")).toBeVisible();
  await expect(page.locator("#week")).toContainText("19 oct");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByText("Cómo se decide el premio",{exact:false}).click();
  await expect(page.getByText("03 · Votación",{exact:true})).toBeVisible();
  await page.screenshot({path:"artifacts/potw-mobile.png",fullPage:true});
});

test("a second week publishes weighted results when voting reaches quorum", async ({ page }) => {
  await page.request.post("/api/login",{multipart:{password:process.env.KORU_E2E_PASSWORD||"test-password"}});
  const key={"X-POTW-Key":process.env.KORU_POTW_MANAGER_KEY||"e2e-captain-key"};
  const base="/api/potw/weeks/2026-10-12";
  for(const [pid,choices] of [["1",["2","3","4"]],["2",["3","1","4"]],["3",["2","1","4"]]]){
    const link=await page.request.post(`${base}/voters/${pid}/link`,{headers:key});
    expect(link.ok()).toBeTruthy();
    const token=(await link.json()).path.split("/").at(-1);
    const saved=await page.request.put(`/api/potw/ballot/${token}`,{data:{choices}});
    expect(saved.ok()).toBeTruthy();
  }
  const closed=await page.request.post(`${base}/manage`,{headers:key,data:{action:"close"}});
  expect((await closed.json()).votesApplied).toBe(true);
  await page.goto("/potw");
  await page.locator("#week").selectOption("2026-10-12");
  await expect(page.locator(".statusbar")).toContainText("80 % rendimiento + 20 % votos");
  await expect(page.locator(".statusbar")).toContainText("3/4 papeletas");
  await expect(page.locator("tbody tr:not(.row-detail)").first()).not.toContainText("Ocultos");
});

test("POTW shows sixteen appearances, eleven scored and five pending without durations",async({page})=>{
  await page.request.post("/api/login",{multipart:{password:process.env.KORU_E2E_PASSWORD||"test-password"}});
  const games=Array.from({length:16},(_,i)=>({matchId:i+1,platform:i<4?"PLG":"VPG",opponent:`Rival ${i+1}`,
    url:`https://example.test/match/${i+1}`,position:"MC",rating:i<11?7.75:null,
    valid:i<11,score:i<11?71.9:null,ratingPoints:i<11?71.9:null,peers:40,penalty:0}));
  const data={week:"2026-10-26",status:"pending",complete:false,minimumGames:8,ballots:0,voters:0,quorum:3,
    snapshotChanged:false,statisticalWinners:["1"],winners:["1"],
    coverage:{totalMatches:16,playedMatches:16,scoredMatches:11,pendingMatches:5,scheduledMatches:0},
    byPlatform:{PLG:{played:4,scored:4},VPG:{played:12,scored:7}},
    players:[{id:"1",name:"Andyelmessy",eligible:true,eligibilityReason:"Candidato",appearances:16,
      ratedAppearances:11,pendingAppearances:5,performance:71.9,finalScore:71.9,rating:7.75,games}],
    matches:games.map((g,i)=>({id:g.matchId,platform:g.platform,round:i+1,date:"2026-10-29T21:00:00Z",url:g.url,
      ready:g.valid,played:true,opponent:g.opponent,forfeit:false}))};
  await page.route("**/api/potw",route=>route.fulfill({json:{weeks:[{week:data.week,status:data.status}],selectedWeek:data.week,
    warnings:[],syncedAt:null,seasonPath:"/es/teams/koru-eclub"}}));
  await page.route("**/api/potw/weeks/2026-10-26",route=>route.fulfill({json:data}));
  await page.goto("/potw");
  await expect(page.locator(".coverage")).toContainText("16 partidos jugados por KORU · 11 con informe completo · 5 pendientes");
  await expect(page.locator("tbody tr:not(.row-detail)")).toContainText("16 / 16");
  await expect(page.locator("tbody tr:not(.row-detail)")).toContainText("11 con nota · 5 pendientes");
  await expect(page.locator("#workspace")).not.toContainText(/minutos|PJ \/ min|s\/d/);
  await page.getByRole("button",{name:"Ver partidos"}).click();
  await expect(page.locator(".row-detail:not([hidden]) .game")).toHaveCount(16);
  await expect(page.locator(".game strong",{hasText:"Informe pendiente"})).toHaveCount(5);
  await expect(page.locator(".score")).toHaveText("71,9");
});
