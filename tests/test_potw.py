import asyncio
import copy
from contextlib import closing
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

os.environ.setdefault("KORU_ACCESS_PASSWORD", "test-password")
os.environ["KORU_POTW_AUTO_SYNC"] = "false"

from fastapi.testclient import TestClient
from app.main import app
from app import storage, potw
from app.potw_scoring import metrics, percentile, rank_week, results, week_of


def player(pid, role="midfielder", rating=7, minutes=90):
    codes = dict(goalkeeper="PO", defender="DFC", midfielder="MC", forward="DC")
    return dict(userId=pid, name=f"Jugador {pid}", position={"group": role, "code": codes[role]}, stats={},
                ea=dict(rating=rating, minutes=minutes, passesMade=20, passAttempts=25,
                        tacklesMade=2, tackleAttempts=4, saves=0, shots=0))


def sample():
    fixtures, reports = [], {}
    for i in range(4):
        fixture = dict(id=100+i, round=1+i, date=f"2026-10-{19+i}T20:40:00Z", published=True,
                       forfeit=False, opponent="Rival", season=6427)
        fixtures.append(fixture)
        reports[100+i] = dict(match={**fixture, "score": {"home": 1, "away": 0}}, competition={"seasonId": 6427},
                             home={"teamId": potw.TEAM, "players": [player(1,rating=8), player(2,rating=7.7), player(3,rating=7.3), player(4,rating=7.1)]},
                             away={"teamId": 7, "players": [player(10,rating=7), player(11,rating=6.7), player(12,rating=6.3), player(13,rating=6)]})
    return fixtures, reports


class ScoringTests(unittest.TestCase):
    def test_madrid_weeks_and_dst(self):
        self.assertEqual(week_of("2026-10-25T23:30:00Z"), "2026-10-26")
        self.assertEqual(week_of("2026-10-18T22:30:00Z"), "2026-10-19")
        self.assertEqual(week_of("2026-10-25T21:30:00Z"), "2026-10-19")

    def test_ties_and_small_samples(self):
        self.assertEqual(percentile(7, [7,7,7,7]),50)
        self.assertEqual(percentile(10,[1,2,10]),50)
        self.assertEqual(percentile(8,[6,7,8,9]),62.5)

    def test_participation_minutes_and_identity(self):
        fixtures, reports = sample()
        for report in list(reports.values())[:2]:
            report["home"]["players"].append(player(5,rating=10))
        reports[103]["home"]["players"][0]["name"] = "Nombre nuevo"
        ranked = rank_week(fixtures,reports,potw.TEAM)
        one=next(p for p in ranked["players"] if p["id"]=="1")
        five=next(p for p in ranked["players"] if p["id"]=="5")
        self.assertEqual(one["appearances"],4)
        self.assertEqual(one["name"],"Nombre nuevo")
        self.assertTrue(five["eligible"])
        self.assertEqual(ranked["minimumGames"],2)
        self.assertEqual(ranked["minimumMinutes"],180)
        for report in reports.values():
            report["home"]["players"][1]["ea"]["minutes"]=40
        two=next(p for p in rank_week(fixtures,reports,potw.TEAM)["players"] if p["id"]=="2")
        self.assertFalse(two["eligible"])

    def test_missing_reports_and_fields_are_not_zeroes(self):
        fixtures, reports=sample()
        incomplete=copy.deepcopy(reports)
        incomplete[100]["home"]["players"][0]["ea"].pop("passesMade")
        view=rank_week(fixtures,incomplete,potw.TEAM)
        self.assertFalse(view["complete"])
        self.assertFalse(view["matches"][0]["ready"])
        self.assertFalse(rank_week(fixtures,{100:reports[100]},potw.TEAM)["complete"])
        fixtures[0]["published"]=False
        self.assertFalse(rank_week(fixtures,reports,potw.TEAM)["matches"][0]["ready"])

    def test_forfeit_excluded_and_reported_forfeit_respected(self):
        fixtures, reports=sample()
        reports[100]["match"]["forfeit"]=True
        view=rank_week(fixtures,reports,potw.TEAM)
        self.assertTrue(view["complete"])
        self.assertEqual(view["minimumGames"],2)
        self.assertEqual(view["players"][0]["appearances"],3)

    def test_position_comparison_and_cards(self):
        fixtures,reports=sample()
        for report in reports.values():
            for side in ("home","away"):
                report[side]["players"] += [player(20 if side=="home" else 21,"goalkeeper",rating=6)]
        view=rank_week(fixtures,reports,potw.TEAM)
        gk=next(p for p in view["players"] if p["id"]=="20")
        self.assertEqual(gk["performance"],50)
        self.assertEqual(gk["games"][0]["peers"],8)
        reports[100]["home"]["players"][0]["stats"]={"5":1,"6":1}
        p=rank_week(fixtures,reports,potw.TEAM)["players"][0]
        self.assertEqual(p["games"][0]["penalty"],8)
        self.assertEqual(metrics(player(9,minutes=5))["valid"],False)

    def test_yellow_cards_do_not_change_performance(self):
        fixtures, reports = sample()
        before = rank_week(fixtures, reports, potw.TEAM)
        for report in reports.values():
            report["home"]["players"][0]["stats"] = {"5": 2}
        after = rank_week(fixtures, reports, potw.TEAM)
        self.assertEqual(before["players"], after["players"])

    def test_quorum_hidden_votes_and_exact_ties(self):
        fixtures,reports=sample()
        snapshot=rank_week(fixtures,reports,potw.TEAM)
        ballots=[{"playerId":str(pid),"choices":["2","3","1"]} for pid in (8,9,10)]
        opened=results(snapshot,ballots,4)
        self.assertIsNone(opened["players"][0]["votePoints"])
        self.assertFalse(opened["votesApplied"])
        self.assertFalse(results(snapshot,ballots[:2],4,True)["votesApplied"])
        closed=results(snapshot,ballots,4,True)
        self.assertTrue(closed["votesApplied"])
        two=next(p for p in closed["players"] if p["id"]=="2")
        self.assertAlmostEqual(two["finalScore"],.8*two["performance"]+20,places=4)
        # Casting your own ballot must not dilute the support received from others.
        support_before=two["voteScore"]
        ballots.append({"playerId":"2","choices":["1","3","4"]})
        after=next(p for p in results(snapshot,ballots,4,True)["players"] if p["id"]=="2")
        self.assertEqual(after["voteScore"],support_before)
        for p in snapshot["players"]:p["performance"]=50
        self.assertEqual(len(results(snapshot,[],4,True)["winners"]),4)


class PotwApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.db=patch.object(storage,"DB_PATH",Path(self.tmp.name)/"test.db")
        self.db.start()
        self.env=patch.dict(os.environ,{"KORU_POTW_MANAGER_KEY":"captain-secret"})
        self.env.start()
        potw.init_potw()
        fixtures,reports=sample()
        with closing(potw.connection()) as conn, conn:
            for f in fixtures:
                conn.execute("INSERT INTO potw_fixtures VALUES (?,?,?)",(f["id"],"2026-10-19",json.dumps(f)))
                conn.execute("INSERT INTO potw_reports VALUES (?,?,?)",(f["id"],json.dumps(reports[f["id"]]),potw.now().isoformat()))
        self.client=TestClient(app)
        self.client.post("/api/login",data={"password":"test-password"})
        self.headers={"X-POTW-Key":"captain-secret"}
        self.week="/api/potw/weeks/2026-10-19"

    def tearDown(self):
        self.client.close();self.db.stop();self.env.stop();self.tmp.cleanup()

    def open(self):
        response=self.client.post(self.week+"/manage",json={"action":"open"},headers=self.headers)
        self.assertEqual(response.status_code,200,response.text)
        return response.json()

    def link(self,pid):
        response=self.client.post(self.week+f"/voters/{pid}/link",headers=self.headers)
        self.assertEqual(response.status_code,200,response.text)
        return "/api/potw/ballot/"+response.json()["path"].split("/")[-1]

    def test_auth_personal_links_and_revocation(self):
        with TestClient(app) as anon:
            self.assertEqual(anon.get("/api/potw").status_code,401)
        self.assertEqual(self.client.post(self.week+"/manage",json={"action":"open"}).status_code,403)
        self.open()
        link=self.link(1)
        with TestClient(app) as anon:
            response=anon.get(link)
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.headers["cache-control"],"no-store")
            self.assertNotIn("1",[p["id"] for p in response.json()["candidates"]])
            self.assertEqual(anon.get("/api/potw/weeks/2026-10-19").status_code,401)
        self.link(1)
        self.assertEqual(self.client.get(link).status_code,404)
        with closing(potw.connection()) as conn, conn:
            self.assertNotIn(link.split("/")[-1],str([tuple(r) for r in conn.execute("SELECT * FROM potw_voters")]))

    def test_ballot_validation_replacement_and_deadline(self):
        self.open();link=self.link(1)
        for choices in (["1","2","3"],["2","2","3"],["2","3","99"],["2"]):
            self.assertEqual(self.client.put(link,json={"choices":choices}).status_code,422)
        self.assertEqual(self.client.put(link,json={"choices":["2","3","4"]}).status_code,200)
        self.assertEqual(self.client.put(link,json={"choices":["4","3","2"]}).status_code,200)
        self.assertEqual(self.client.get(self.week).json()["ballots"],1)
        self.assertEqual(self.client.get(link).json()["choices"],["4","3","2"])
        with closing(potw.connection()) as conn, conn:
            conn.execute("UPDATE potw_weeks SET closes_at=?",((potw.now()-timedelta(seconds=1)).isoformat(),))
        self.assertEqual(self.client.put(link,json={"choices":["2","3","4"]}).status_code,409)
        self.assertEqual(self.client.get(self.week).json()["status"],"closed")

    def test_frozen_snapshot_and_final_quorum(self):
        original=self.open()
        for pid,choices in [(1,["2","3","4"]),(2,["1","3","4"]),(3,["2","1","4"])]:
            self.client.put(self.link(pid),json={"choices":choices})
        before=self.client.get(self.week).json()
        self.assertTrue(all(p["votePoints"] is None for p in before["players"]))
        self.assertFalse(before["votesApplied"])
        with closing(potw.connection()) as conn, conn:
            raw=json.loads(conn.execute("SELECT payload FROM potw_reports WHERE id=100").fetchone()[0])
            raw["home"]["players"][0]["ea"]["rating"]=1
            conn.execute("UPDATE potw_reports SET payload=? WHERE id=100",(json.dumps(raw),))
        changed=self.client.get(self.week).json()
        self.assertTrue(changed["snapshotChanged"])
        self.assertEqual(original["players"][0]["performance"],changed["players"][0]["performance"])
        final=self.client.post(self.week+"/manage",json={"action":"close"},headers=self.headers).json()
        self.assertTrue(final["votesApplied"])
        self.assertEqual(final["ballots"],3)
        self.assertEqual(self.client.post(self.week+"/manage",json={"action":"open"},headers=self.headers).status_code,409)
        self.assertEqual(self.client.post(self.week+"/voters/1/link",headers=self.headers).status_code,409)

    def test_auto_open_close_and_incomplete_blocks(self):
        with patch.object(potw,"now",return_value=datetime(2026,10,23,12,tzinfo=timezone.utc)):
            potw.advance_weeks();potw.advance_weeks()
            self.assertEqual(self.client.get(self.week).json()["status"],"open")
        with patch.object(potw,"now",return_value=datetime(2026,10,26,12,tzinfo=timezone.utc)):
            potw.advance_weeks()
            self.assertEqual(self.client.get(self.week).json()["status"],"closed")
        with closing(potw.connection()) as conn, conn:
            self.assertEqual(conn.execute("SELECT count(*) FROM potw_voters").fetchone()[0],4)

    def test_import_preserves_postponed_week_and_cache_on_error(self):
        fixtures,_=sample()
        raw=[dict(f,team1=potw.TEAM,team2=7,homeTeam={"name":"Koru"},awayTeam={"name":"Rival"}) for f in fixtures]
        raw[0]["date"]="2026-11-02T21:40:00Z"
        with patch.object(potw,"_last_attempt",None),patch.object(potw,"fetch_page",new=AsyncMock(return_value={"table":[{"tid":potw.TEAM,"matches":raw}]})):
            asyncio.run(potw.sync_vpn())
        with closing(potw.connection()) as conn, conn:
            self.assertEqual(conn.execute("SELECT week FROM potw_fixtures WHERE id=100").fetchone()[0],"2026-10-19")
        with patch.object(potw,"_last_attempt",None),patch.object(potw,"fetch_page",new=AsyncMock(side_effect=ValueError("offline"))):
            response=asyncio.run(potw.sync_vpn())
        self.assertIn("caché",response["message"])
        self.assertEqual(len(potw.source_data()[0]),4)
        self.assertEqual(len(potw.source_data()[1]),4)

    def test_parser_and_foreign_report_rejected(self):
        self.assertEqual(potw.parse_page('<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"ok":true}}}</script>'),{"ok":True})
        with self.assertRaises(ValueError):potw.parse_page("<html>blocked</html>")
        fixtures,reports=sample();reports[100]["competition"]["seasonId"]=99
        with self.assertRaises(ValueError):potw.validate_report(reports[100],fixtures[0])


if __name__ == "__main__":unittest.main()
