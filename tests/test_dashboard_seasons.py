import asyncio
import json
import tempfile
import unittest
from datetime import timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch
from app.services.dashboard import (DashboardService, SeasonDashboardService, CurrentSplitService,
    CURRENT_PLG, _parse_plg_datetime, _normalize_plg_match)

class SeasonTests(unittest.IsolatedAsyncioTestCase):
    def test_plg_utc_and_naive_timestamps(self):
        self.assertEqual(_parse_plg_datetime('2026-10-19T20:40:00Z').hour,20)
        self.assertEqual(_parse_plg_datetime('2026-10-19T22:40:00+02:00').hour,20)
        self.assertEqual(_parse_plg_datetime('2026-10-19T22:40:00').hour,20)
        self.assertEqual(_parse_plg_datetime('2026-11-02T22:40:00').hour,21)

    async def test_archive_is_immutable_even_when_forced(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'fc26.json'
            expected={'season':{'id':'fc26'},'summary':{'points':73}}
            path.write_text(json.dumps(expected))
            service=SeasonDashboardService(path)
            service.current.get_dashboard=AsyncMock(side_effect=AssertionError('No network for archive'))
            self.assertEqual(await service.get_dashboard(force=True,season='fc26'),expected)
            self.assertEqual(json.loads(path.read_text()),expected)
            with self.assertRaises(ValueError):await service.get_dashboard(season='unknown')

    async def test_current_does_not_reuse_legacy_vpg_statistics_or_mutate_cache(self):
        service=SeasonDashboardService()
        raw={'competitions':[], 'warnings':[], 'sources':[], 'leaderboards':{'scorers':[]}}
        service.current.get_dashboard=AsyncMock(return_value=raw)
        first=await service.get_dashboard()
        second=await service.get_dashboard()
        self.assertEqual(len(first['competitions']),3)
        self.assertEqual(len(second['competitions']),3)
        self.assertEqual(raw['competitions'],[])
        self.assertEqual(first['competitions'][0]['status'],'unavailable')
        self.assertTrue(all(not c['standings'] for c in first['competitions'][1:]))

    async def test_current_vpg_pins_division_and_excludes_old_zero_stats(self):
        seen=[]
        current={"id":1,"league_slug":"segunda-division-a-spain","season":12,"datetime":"2026-10-26T22:00:00Z"}
        old=dict(current,id=2,season=11)
        zero=dict(current,id=3,league_slug="vpg-zero-spain",season=4)
        async def fetch(client,url,params=None):
            seen.append((url,params))
            if url.endswith('/matches/'):
                return {"data":[current,old,zero]} if params['match_status']=='complete' else {"data":[current]}
            if '/vpg-zero-spain/table/' in url:return [{"played":17}]
            return []
        service=CurrentSplitService()
        service._fetch_json=fetch
        data=await service._fetch_vpg(None)
        self.assertEqual(data['scheduled'],[current])
        self.assertEqual(data['complete'],[current])
        self.assertEqual(data['table:vpg-zero-spain'],[])
        self.assertNotIn('record',data)
        self.assertNotIn('scorers',data)
        self.assertIn(('https://api.virtualprogaming.com/public/leagues/segunda-division-a-spain/table/',{'season':12}),seen)

    @patch("app.services.dashboard.potw.meta", side_effect=lambda key, default=None: default)
    @patch("app.services.dashboard.potw.source_data", return_value=([], {}))
    async def test_pinned_plg_season_filters_old_results_and_other_tournaments(self, source, meta):
        old={'id':1,'season':6382,'matchSeason':{'id':6382}}
        new={'id':2,'season':6427,'matchSeason':{'id':6427}}
        cup={'id':3,'season':6423,'matchSeason':{'id':6423}}
        seen=[]
        async def fetch(client,url,params=None):
            seen.append((url,params))
            if url.endswith('/fixtures'):return {'rows':[old,new,cup]}
            if url.endswith('/results'):return {'rows':[old,new,cup]}
            if '/table' in url:return []
            if '/leagues/' in url:return {'seasons':[{'id':9999,'active':1}]}
            return {}
        service=CurrentSplitService()
        service._fetch_json=fetch
        data=await service._fetch_plg(None)
        self.assertEqual(data['active_season'],6427)
        self.assertEqual(data['fixtures'],[new])
        self.assertEqual(data['results'],[new])
        self.assertIn(('https://www.virtualpronetwork.com/api/leagues/2215/table',{'season':6427}),seen)

    async def test_historical_vpg_table_queries_explicit_season(self):
        seen=[]
        async def fetch(client,url,params=None):
            seen.append((url,params))
            return []
        service=DashboardService(vpg_leagues=[{"slug":"cuarta-division-a-spain","season":11}],persist_analytics=False)
        service._fetch_json=fetch
        await service._fetch_vpg(None)
        self.assertIn(('https://api.virtualprogaming.com/public/leagues/cuarta-division-a-spain/table/',{'season':11}),seen)

    async def test_dashboard_api_rejects_unknown_season(self):
        from fastapi.testclient import TestClient
        from app.main import app
        with patch('app.main._is_authenticated',return_value=True), patch('app.main.dashboard_service.get_dashboard',new_callable=AsyncMock) as fetch:
            fetch.return_value={'season':{'id':'fc26'}}
            client=TestClient(app)
            try:
                response=client.get('/api/dashboard?season=fc26&force=true')
                self.assertEqual(response.status_code,200)
                fetch.assert_awaited_once_with(force=True,season='fc26')
                fetch.reset_mock()
                self.assertEqual(client.get('/api/dashboard?season=untrusted').status_code,422)
                fetch.assert_not_awaited()
            finally:
                client.close()

    def test_match_uses_actual_competition(self):
        row={'id':1,'team1':29377,'date':'2026-10-19T20:40:00Z',
             'matchSeason':{'league':{'name':'3ª DIVISIÓN B - PLG','url':'3a-division-b-plg'}}}
        data=_normalize_plg_match(row,'scheduled')
        self.assertEqual(data['competition'],'3ª DIVISIÓN B - PLG')
        self.assertEqual(data['competitionSlug'],'3a-division-b-plg')

if __name__=='__main__':unittest.main()

