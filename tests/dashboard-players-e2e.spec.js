import { test, expect } from "@playwright/test";

for(const width of [1440,390]){
  test(`dashboard shows PLG players, goals, assists and ratings at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:1000});
    await page.request.post("/api/login",{multipart:{password:process.env.KORU_E2E_PASSWORD||"test-password"}});
    const player={key:"plg:1",platform:"PLG",username:"Compañero PLG",matchesPlayed:4,value:3,rank:1,goals:3,assists:2,rating:7.75,elo:1450,eloDelta:0};
    const leaders={scorers:[player],assists:[{...player,value:2}],ratings:[{...player,value:7.75}]};
    const rankings={overall:[player],goals:[player],assists:[player],rating:[player]};
    const data={updatedAt:"2026-10-24T10:00:00Z",team:{name:"KORU",socials:{}},summary:{},competitions:[],
      upcoming:[],recent:[],nextMatch:null,sources:[],warnings:[],leaderboards:leaders,
      leaderboardsBySource:{plg:leaders,vpg:{scorers:[],assists:[],ratings:[]}},
      playerStatsCoverage:{reportedMatches:4,expectedMatches:4,seasonId:6427},
      analytics:{summary:{},playerRankings:rankings,teamElo:[],trends:{}},
      playerRankingsBySource:{plg:rankings,vpg:{overall:[],goals:[],assists:[],rating:[]}}};
    await page.route("**/api/dashboard*",route=>route.fulfill({json:data}));
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    await page.goto("/",{waitUntil:"domcontentloaded"});
    await expect(page.locator("#leaderboard-list")).toContainText("Compañero PLG");
    await expect(page.locator("#player-stats-scope")).toContainText("4/4 informes");
    await page.locator("#player-source").selectOption("plg");
    await expect(page.locator("#leaderboard-list .leader-value")).toHaveText("3");
    const nameBox=await page.locator("#leaderboard-list .leader-name").boundingBox();
    const valueBox=await page.locator("#leaderboard-list .leader-value").boundingBox();
    expect(valueBox.x).toBeGreaterThan(nameBox.x);
    await page.locator('[data-leader="assists"]').click();
    await expect(page.locator("#leaderboard-list .leader-value")).toHaveText("2");
    await page.locator('[data-leader="ratings"]').click();
    await expect(page.locator("#leaderboard-list .leader-value")).toContainText("7.8");
    await expect(page.locator("#player-elo-list")).toContainText("G 3 · A 2");
    await page.locator("#player-source").selectOption("vpg");
    await expect(page.locator("#leaderboard-list")).toContainText("La fuente de VPG no devuelve");
    await expect(page.locator("#player-elo-list")).not.toContainText("Compañero PLG");
    await page.locator("#player-source").selectOption("all");
    await expect(page.locator("#leaderboard-list")).toContainText("Compañero PLG");
    expect(errors).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}
