import asyncio
import copy
import json
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

import httpx
from test_potw import sample, player
from app import potw, storage
from app.potw_scoring import metrics, rank_week, results
from app.potw_vpg import match_pages, sync_vpg


def sixteen_games():
    fixtures, reports = [], {}
    for i in range(16):
        f = dict(id=1000+i, round=i+1, date="2026-10-29T20:00:00Z", season=6427,
                 published=True, platform="PLG" if i < 4 else "VPG", opponent="Rival")
        fixtures.append(f)
        reports[f["id"]] = dict(match=dict(id=f["id"],published=True,forfeit=False),
            home=dict(teamId=potw.TEAM,players=[player(1,rating=8),player(2,rating=7)]),
            away=dict(teamId=7,players=[player(3,rating=6),player(4,rating=5)]))
        if i >= 11:
            # One missing teammate holds the report pending for everybody.
            reports[f["id"]]["home"]["players"][1]["ea"]["rating"] = 0
    return fixtures, reports


class AppearanceScoringTests(unittest.TestCase):
    def test_managers_sixteen_eleven_five_example(self):
        fixtures, reports = sixteen_games()
        ranked = rank_week(fixtures, reports, potw.TEAM)
        self.assertEqual(ranked["coverage"]["playedMatches"],16)
        self.assertEqual(ranked["coverage"]["scoredMatches"],11)
        self.assertEqual(ranked["coverage"]["pendingMatches"],5)
        self.assertEqual(ranked["minimumGames"],8)
        self.assertFalse(ranked["complete"])
        for p in ranked["players"]:
            self.assertEqual((p["appearances"],p["ratedAppearances"],p["pendingAppearances"]),(16,11,5))
            self.assertEqual(p["performance"],sum(g["score"] for g in p["games"] if g["score"] is not None)/11)

    def test_duration_fields_have_no_effect_whatsoever(self):
        fixtures, reports = sample()
        before = rank_week(fixtures,reports,potw.TEAM)
        values = [None,0,-1,1,15,99999,"not-published"]
        for i,report in enumerate(reports.values()):
            for side in ("home","away"):
                for j,p in enumerate(report[side]["players"]):
                    p["ea"]["minutes"]=values[(i+j)%len(values)]
            report["home"]["players"][0]["ea"].pop("minutes")
        self.assertEqual(before,rank_week(fixtures,reports,potw.TEAM))
        self.assertNotIn("minutes",json.dumps(before))
        self.assertNotIn("minimumMinutes",before)

    def test_each_rated_game_has_equal_weight(self):
        fixtures,reports=sample()
        reports[100]["home"]["players"][0]["ea"].update(rating=10,minutes=1)
        reports[101]["home"]["players"][0]["ea"].update(rating=6,minutes=90)
        p=next(p for p in rank_week(fixtures[:2],reports,potw.TEAM)["players"] if p["id"]=="1")
        self.assertEqual(p["rating"],8)
        self.assertEqual(p["performance"],round(sum(g["score"] for g in p["games"])/2,4))

    def test_absent_report_is_not_absence_or_a_zero_score(self):
        fixtures,reports=sample()
        reports.pop(100)
        for report in reports.values():
            report["home"]["players"][0]["ea"]["rating"]=0
        view=rank_week(fixtures,reports,potw.TEAM)
        p=next(p for p in view["players"] if p["id"]=="1")
        self.assertEqual(p["appearances"],3)
        self.assertIsNone(p["performance"])
        self.assertEqual(p["pendingAppearances"],3)
        self.assertFalse(view["matches"][0]["lineupKnown"])
        self.assertEqual(view["coverage"]["playedMatches"],4)
        self.assertIsNone(next(p for p in results(view,[],0)["players"] if p["id"]=="1")["finalScore"])

    def test_platform_pools_are_separate_and_duplicates_do_not_count_twice(self):
        fixtures,reports=sample()
        fixtures[2]["platform"]=fixtures[3]["platform"]="VPG"
        ranked=rank_week(fixtures+fixtures,reports,potw.TEAM)
        self.assertEqual(ranked["coverage"]["playedMatches"],4)
        p=ranked["players"][0]
        self.assertEqual(p["appearances"],4)
        self.assertTrue(all(g["peers"]==16 for g in p["games"]))
        self.assertEqual(set(ranked["byPlatform"]),{"PLG","VPG"})

    def test_future_games_do_not_count_as_played_or_as_an_absence(self):
        fixtures,reports=sample()
        fixtures[3]["published"]=False
        view=rank_week(fixtures,reports,potw.TEAM)
        self.assertEqual(view["coverage"]["playedMatches"],3)
        self.assertEqual(view["coverage"]["scheduledMatches"],1)
        self.assertEqual(view["players"][0]["appearances"],3)
        self.assertFalse(view["complete"])

    def test_no_action_totals_are_required_for_an_appearance(self):
        p=player(1);p["ea"]={"rating":7.5}
        self.assertTrue(metrics(p)["valid"])


class VpgImportTests(unittest.TestCase):
    def test_pagination_follows_count_even_when_provider_caps_pages(self):
        offsets=[]
        def respond(request):
            offset=int(request.url.params["offset"]);offsets.append(offset)
            return httpx.Response(200,json={"count":65,"data":[{"id":i} for i in range(offset,min(offset+30,65))]})
        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
                return await match_pages(client,"complete")
        self.assertEqual(len(asyncio.run(run())),65)
        self.assertEqual(offsets,[0,30,60])

    def test_repeated_page_is_detected_instead_of_silently_undercounting(self):
        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(200,json={"count":2,"data":[{"id":1}]}))) as client:
                return await match_pages(client,"complete")
        with self.assertRaises(ValueError):asyncio.run(run())

    def test_verified_gamertags_link_players_and_profile_fields_are_minimal(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(storage,"DB_PATH",Path(temp)/"test.db"):
            potw.init_potw()
            fixtures,reports=sample()
            reports[100]["home"]["players"][0]["platformIds"]={"pc":"VerifiedEA"}
            with closing(potw.connection()) as conn, conn:
                conn.execute("INSERT INTO potw_fixtures VALUES (?,?,?)",(100,"2026-10-19",json.dumps(fixtures[0])))
                conn.execute("INSERT INTO potw_reports VALUES (?,?,?)",(100,json.dumps(reports[100]),potw.now().isoformat()))
            match=dict(id=900,datetime="2026-10-20T20:00:00Z",home_id=36769,away_id=9,home_name="KORU",away_name="Rival",
                       season=12,league_slug="current",league_name="VPG",status="complete",match_day=1)
            def respond(request):
                path=request.url.path
                if path.endswith("/leagues/"):data=[dict(slug="current")]
                elif path.endswith("/matches/"):data={"count":1,"data":[match]} if request.url.params["match_status"]=="complete" else {"count":0,"data":[]}
                elif path.endswith("/data/"):data=[dict(match_id=900,team_id=36769,user_id=500,username="DifferentLogin",position="CM",match_rating=8)]
                else:data=dict(id=500,username="DifferentLogin",origin="VerifiedEA",email="must-not-persist@example.test")
                return httpx.Response(200,json=data)
            async def run():
                async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:return await sync_vpg(client)
            self.assertTrue(asyncio.run(run())["ok"])
            fixtures,reports=potw.award_data()
            self.assertEqual(reports["vpg:900"]["home"]["players"][0]["userId"],"1")
            with closing(potw.connection()) as conn:
                saved=conn.execute("SELECT payload FROM potw_vpg_users").fetchone()[0]
                self.assertNotIn("email",saved)
                self.assertNotIn("must-not-persist",saved)
            self.assertEqual(rank_week([f for _,f in fixtures],reports,potw.TEAM)["coverage"]["playedMatches"],2)
