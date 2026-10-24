import asyncio
import unittest
from unittest.mock import patch

from app.services.dashboard import DashboardService, _parse_plg_datetime, _vpg_configs, _normalize_vpg_match


class CompetitionSourceTests(unittest.TestCase):
    def test_memberships_determine_names_slugs_and_source_links(self):
        rows=[dict(name="TERCERA DIVISION B",slug="tercera-division-b-spain"),
              dict(name="ZERO MASTERS",slug="vpg-zero-spain")]
        configs=_vpg_configs(rows+rows)
        self.assertEqual(len(configs),2)
        self.assertEqual(configs[0]["platform"],"VPG Zero")
        self.assertEqual(configs[1]["name"],"TERCERA DIVISION B")
        self.assertTrue(configs[1]["url"].endswith("/tercera-division-b-spain"))
        self.assertEqual(_vpg_configs([dict(slug="../other",name="bad")]),[])

    def test_fetch_requests_actual_memberships_and_handles_an_empty_season(self):
        requested=[]
        async def fake(client,url,params=None):
            requested.append(url)
            if url.endswith("/teams/koru-eclub/leagues/"):
                return [dict(name="TERCERA DIVISION B",slug="tercera-division-b-spain")]
            return []
        service=DashboardService()
        with patch.object(service,"_fetch_json",side_effect=fake), patch("app.services.dashboard._persist_analytics_snapshot"):
            vpg=asyncio.run(service._fetch_vpg(None))
            dashboard=service._build_dashboard(vpg,{})
        self.assertTrue(any(u.endswith("/tercera-division-b-spain/table/") for u in requested))
        self.assertFalse(any("segunda-division" in u or "zero-gold" in u for u in requested))
        self.assertEqual(len(dashboard["competitions"]),1)
        self.assertEqual(dashboard["competitions"][0]["name"],"TERCERA DIVISION B")
        self.assertIsNone(dashboard["competitions"][0]["koru"])

    @patch("app.services.dashboard._persist_analytics_snapshot")
    def test_historical_other_league_matches_do_not_enter_active_competitions(self,persist):
        configs=_vpg_configs([dict(name="ZERO MASTERS",slug="vpg-zero-spain")])
        vpg={"configs":configs,"complete":{"data":[dict(id=1,league_slug="zero-gold")]}}
        comp=DashboardService()._build_dashboard(vpg,{})["competitions"][0]
        self.assertEqual(comp["recent"],[])
        self.assertEqual(comp["name"],"ZERO MASTERS")

    def test_madrid_dates_honor_source_offsets_and_dst(self):
        self.assertEqual(_parse_plg_datetime("2026-10-19T20:40:00.000Z").isoformat(),"2026-10-19T20:40:00+00:00")
        self.assertEqual(_parse_plg_datetime("2026-10-19T22:40:00+02:00").isoformat(),"2026-10-19T20:40:00+00:00")
        self.assertEqual(_parse_plg_datetime("2026-10-19T22:40:00").isoformat(),"2026-10-19T20:40:00+00:00")
        self.assertEqual(_parse_plg_datetime("2026-10-26T22:40:00").isoformat(),"2026-10-26T21:40:00+00:00")

    @patch("app.services.dashboard._persist_analytics_snapshot")
    def test_same_league_previous_season_is_excluded(self,persist):
        slug="segunda-division-a-spain"
        config=_vpg_configs([dict(name="SEGUNDA DIVISION A",slug=slug)])
        match=dict(id=1,league_slug=slug,season=11,datetime="2026-06-01T20:00:00Z")
        vpg=dict(configs=config,scheduled=[dict(match,id=2,season=12)],complete=[match])
        comp=DashboardService()._build_dashboard(vpg,{})["competitions"][0]
        self.assertEqual(len(comp["upcoming"]),1)
        self.assertEqual(comp["recent"],[])

    def test_zero_platform_classification_follows_active_slug(self):
        match=dict(id=1,league_slug="vpg-zero-spain",datetime="2026-10-26T21:00:00Z")
        self.assertEqual(_normalize_vpg_match(match)["platform"],"VPG Zero")


if __name__=="__main__":unittest.main()
