import unittest
from unittest.mock import patch

from test_potw import sample
from app.services.plg_players import combine_leaders, player_statistics
from app.services.dashboard import DashboardService, _analytics
from app.potw import TEAM


class PlgPlayerTests(unittest.TestCase):
    def test_season_totals_identity_rating_and_zeroes(self):
        fixtures,reports=sample()
        for report in reports.values():
            report["home"]["players"][0]["season"]={"totals":{"1":999},"appearances":999}
            report["home"]["players"][0]["stats"]={"1":1,"2":2}
        reports[103]["home"]["players"][0]["name"]="Renombrado"
        data=player_statistics(fixtures+fixtures,reports,TEAM,6427)
        first=next(p for p in data["players"] if p["playerId"]=="1")
        self.assertEqual(first["goals"],4)
        self.assertEqual(first["assists"],8)
        self.assertEqual(first["matchesPlayed"],4)
        self.assertEqual(first["rating"],8)
        self.assertEqual(first["username"],"Renombrado")
        self.assertEqual(data["reportedMatches"],4)
        self.assertEqual(data["expectedMatches"],4)
        self.assertTrue(any(p["value"]==0 for p in data["leaderboards"]["scorers"]))

    def test_exclude_other_seasons_forfeits_unpublished_and_opponents(self):
        fixtures,reports=sample()
        fixtures[0]["season"]=99
        reports[101]["match"]["forfeit"]=True
        fixtures[2]["published"]=False
        data=player_statistics(fixtures,reports,TEAM,6427)
        self.assertEqual(data["reportedMatches"],1)
        self.assertEqual(len(data["players"]),4)
        self.assertTrue(all(p["matchesPlayed"]==1 for p in data["players"]))
        self.assertTrue(all(p["playerId"] not in {"10","11","12","13"} for p in data["players"]))

    def test_missing_report_and_rating_are_not_invented(self):
        fixtures,reports=sample()
        reports.pop(100)
        for report in reports.values():
            report["home"]["players"][0]["ea"].pop("rating")
        data=player_statistics(fixtures,reports,TEAM,6427)
        self.assertEqual(data["reportedMatches"],3)
        self.assertEqual(data["expectedMatches"],4)
        self.assertIsNone(next(p for p in data["players"] if p["playerId"]=="1")["rating"])
        self.assertNotIn("1",[p["playerId"] for p in data["leaderboards"]["ratings"]])

    def test_sources_with_same_names_do_not_merge(self):
        fixtures,reports=sample()
        plg=player_statistics(fixtures,reports,TEAM,6427)["leaderboards"]
        vpg={"scorers":[{"username":"Jugador 1","value":9,"matchesPlayed":3,"platform":"VPG"}],
             "ratings":[{"username":"Jugador 1","value":24,"matchesPlayed":3,"platform":"VPG"}]}
        merged=combine_leaders(vpg,plg)
        analytics=_analytics([],[],merged)
        same=[p for p in analytics["playerElo"] if p["username"]=="Jugador 1"]
        self.assertEqual(len(same),2)
        self.assertEqual({p["platform"] for p in same},{"VPG","PLG"})
        self.assertEqual(next(p for p in merged["ratings"] if p["platform"]=="VPG")["value"],8)

    @patch("app.services.dashboard._persist_analytics_snapshot")
    def test_dashboard_exposes_plg_leaders_and_only_active_season_matches(self, persist):
        fixtures,reports=sample()
        stats=player_statistics(fixtures,reports,TEAM,6427)
        match=dict(id=100,season=6427,date="2026-10-19T20:40:00Z",team1=TEAM,team2=7,gteam1=1,gteam2=0,
                   homeTeam={"name":"KORU"},awayTeam={"name":"Rival"})
        historical=dict(match,id=99,season=6000)
        dashboard=DashboardService()._build_dashboard({},dict(playerStats=stats,active_season=6427,results=[match,historical]))
        self.assertEqual(len(dashboard["leaderboardsBySource"]["plg"]["scorers"]),4)
        self.assertEqual(len(dashboard["analytics"]["playerElo"]),4)
        plg=next(c for c in dashboard["competitions"] if c["platform"]=="PLG")
        self.assertEqual(len(plg["recent"]),1)
        self.assertEqual(plg["recent"][0]["url"],"https://virtualpronetwork.com/es/matches/100")
        self.assertEqual(dashboard["playerStatsCoverage"]["seasonId"],6427)


if __name__=="__main__":unittest.main()
