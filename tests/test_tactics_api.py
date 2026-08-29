import os
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("KORU_ACCESS_PASSWORD", "test-password")
os.environ.setdefault("KORU_AUTH_SECRET", "test-secret")

from fastapi.testclient import TestClient

import app.storage as storage
from app.main import app


class TacticalApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.original_paths = (storage.DATA_DIR, storage.UPLOAD_DIR, storage.DB_PATH)
        storage.DATA_DIR = root / "data"
        storage.UPLOAD_DIR = root / "uploads"
        storage.DB_PATH = storage.DATA_DIR / "api-test.db"
        storage.init_storage()
        self.client = TestClient(app)
        response = self.client.post("/api/login", data={"password": "test-password"})
        self.assertEqual(response.status_code, 200)

    def tearDown(self) -> None:
        self.client.close()
        storage.DATA_DIR, storage.UPLOAD_DIR, storage.DB_PATH = self.original_paths
        self.temp_dir.cleanup()

    def payload(self) -> dict:
        return {
            "name": "Presion alta",
            "category": "Presion",
            "teamId": "koru-eclub",
            "document": {
                "schemaVersion": 1,
                "pitch": {"width": 105, "height": 68},
                "teams": [
                    {"id": "home", "name": "KORU", "primaryColor": "#f95516", "secondaryColor": "#ffffff"}
                ],
            },
        }

    def test_authenticated_board_crud_and_page(self) -> None:
        page = self.client.get("/tactics")
        self.assertEqual(page.status_code, 200)
        history_page = self.client.get("/match-history")
        self.assertEqual(history_page.status_code, 200)

        created = self.client.post("/api/tactical-boards", json=self.payload())
        self.assertEqual(created.status_code, 201)
        board = created.json()
        self.assertEqual(board["document"]["schemaVersion"], 3)
        self.assertIn("analysis", board["document"])

        listed = self.client.get("/api/tactical-boards")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()[0]["id"], board["id"])

        update = {**self.payload(), "name": "Presion alta editada", "version": board["version"]}
        saved = self.client.put(f"/api/tactical-boards/{board['id']}", json=update)
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()["version"], 2)

        conflict = self.client.put(f"/api/tactical-boards/{board['id']}", json=update)
        self.assertEqual(conflict.status_code, 409)

        deleted = self.client.delete(f"/api/tactical-boards/{board['id']}")
        self.assertEqual(deleted.status_code, 200)

    def test_match_report_upsert_and_list(self) -> None:
        payload = {
            "matchId": "vpg-zero-2026-09-01-koru-rival",
            "opponent": "Rival FC",
            "competition": "VPG Zero",
            "matchDate": "2026-09-01T21:30:00+00:00",
            "status": "post-match",
            "scoreFor": 3,
            "scoreAgainst": 1,
            "lineup": ["Ricky", "Muro"],
            "summary": "Buena presion tras perdida.",
            "takeaways": "Mantener el doble pivote.",
            "tags": ["presion", "transicion"],
        }
        saved = self.client.put(f"/api/match-reports/{payload['matchId']}", json=payload)
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()["scoreFor"], 3)
        self.assertEqual(saved.json()["lineup"], ["Ricky", "Muro"])

        listed = self.client.get("/api/match-reports")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()[0]["matchId"], payload["matchId"])

        board_payload = self.payload()
        board_payload["matchId"] = payload["matchId"]
        board = self.client.post("/api/tactical-boards", json=board_payload)
        self.assertEqual(board.status_code, 201)
        history = self.client.get("/api/match-history")
        self.assertEqual(history.status_code, 200)
        dossier = history.json()[0]
        self.assertEqual(dossier["matchId"], payload["matchId"])
        self.assertEqual(dossier["boardCount"], 1)

    def test_custom_player_crud(self) -> None:
        created = self.client.post(
            "/api/tactical-players",
            json={"name": "Ricky", "number": 10, "position": "MCO", "team": "home", "avatarUrl": "/uploads/ricky.webp"},
        )
        self.assertEqual(created.status_code, 201)
        player = created.json()
        self.assertEqual(player["number"], 10)
        self.assertEqual(player["avatarUrl"], "/uploads/ricky.webp")

        listed = self.client.get("/api/tactical-players?team=home")
        self.assertEqual([item["id"] for item in listed.json()], [player["id"]])

        invalid = self.client.post(
            "/api/tactical-players",
            json={"name": "Unsafe", "number": 9, "position": "DC", "team": "home", "avatarUrl": "http://example.com/a.png"},
        )
        self.assertEqual(invalid.status_code, 422)

        deleted = self.client.delete(f"/api/tactical-players/{player['id']}")
        self.assertEqual(deleted.status_code, 200)


if __name__ == "__main__":
    unittest.main()
