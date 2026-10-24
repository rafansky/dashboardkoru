import os
import unittest
from unittest.mock import patch

import httpx
from fastapi import HTTPException
from fastapi.testclient import TestClient

os.environ.setdefault("KORU_ACCESS_PASSWORD", "test-password")
os.environ.setdefault("KORU_AUTH_SECRET", "test-secret")

from app import player_lookup as lookup
from app.main import app


def profile():
    return {"userId": "123", "profileData": {"user": {"id": 123, "username": "Otro club", "origin": "OtroID"}},
            "general": {"matches": 25, "titles": 1, "events": [{"lang": "goals", "total": 4}]},
            "userTeams": [{"active": 1, "game_id": 1, "team": {"id": 9, "name": "Rival"}}]}


def history():
    return {"userId": "123", "history": {"career": {"page": 2, "perPage": 20, "count": 21,
        "rows": [{"team": {"name": "Anterior"}, "league": {"name": "Liga", "gameId": 1},
                  "season": {"number": 3}, "games": 10, "events": {"assists": 2}}]}}}


class LookupTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        lookup._cache.clear()

    async def test_arbitrary_player_identity_stats_and_history_pagination(self):
        calls = []
        async def get(client, url):
            calls.append(url)
            payload = history() if '/history' in url else profile()
            import json
            return httpx.Response(200, request=httpx.Request('GET', url), text=
                '<script id="__NEXT_DATA__">' + json.dumps({"props": {"pageProps": payload}}) + '</script>')
        with patch.object(httpx.AsyncClient, 'get', get):
            result = await lookup.lookup_player('123', 2)
            self.assertEqual(result['name'], 'Otro club')
            self.assertEqual(result['currentTeams'][0]['name'], 'Rival')
            self.assertEqual(result['history'][0]['team'], 'Anterior')
            self.assertEqual(result['historyPage'], 2)
            self.assertEqual(result['stats'][0]['value'], 4)
            self.assertTrue(any('/123/general' in url for url in calls))
            self.assertTrue(any('/history?page=2' in url for url in calls))
            self.assertEqual(result, await lookup.lookup_player('123', 2))
            self.assertEqual(len(calls), 2)

    async def test_invalid_ids_never_reach_network(self):
        for identifier in ['https://bad.test/', '../admin', 'a?b', '']:
            with self.assertRaises(HTTPException) as error:
                await lookup.lookup_player(identifier)
            self.assertEqual(error.exception.status_code, 400)

    async def test_not_found_and_source_failure(self):
        for status, expected in [(404, 404), (503, 502)]:
            async def get(client, url):
                return httpx.Response(status, request=httpx.Request('GET', url))
            with patch.object(httpx.AsyncClient, 'get', get):
                with self.assertRaises(HTTPException) as error:
                    await lookup.lookup_player('123')
                self.assertEqual(error.exception.status_code, expected)

    def test_identity_mismatch_is_rejected(self):
        h = history()
        h['userId'] = '999'
        with self.assertRaises(ValueError):
            lookup.normalize_profile(profile(), h)

    def test_unknown_stats_remain_unknown(self):
        p = profile()
        p['general'] = {}
        result = lookup.normalize_profile(p, history())
        self.assertIsNone(result['matches'])
        self.assertEqual(result['stats'], [])

    def test_lookup_remains_private(self):
        client = TestClient(app)
        self.assertIn(client.get('/players', follow_redirects=False).status_code, (302, 303, 307))
        self.assertEqual(client.get('/api/players/lookup?identifier=123').status_code, 401)
