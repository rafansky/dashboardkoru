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
        self.assertEqual(board["document"]["schemaVersion"], 4)
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

        uploaded = self.client.post("/api/files", files={"file": ("plan.txt", b"Plan de partido", "text/plain")})
        self.assertEqual(uploaded.status_code, 200)
        attached = self.client.post(
            f"/api/match-reports/{payload['matchId']}/files",
            json={"fileId": uploaded.json()["id"]},
        )
        self.assertEqual(attached.status_code, 201)
        attachments = self.client.get(f"/api/match-reports/{payload['matchId']}/files")
        self.assertEqual(attachments.json()[0]["original_name"], "plan.txt")
        history_with_file = self.client.get("/api/match-history")
        self.assertEqual(history_with_file.json()[0]["attachmentCount"], 1)
        detached = self.client.delete(f"/api/match-reports/{payload['matchId']}/files/{uploaded.json()['id']}")
        self.assertEqual(detached.status_code, 200)

        plan_payload = {
            "matchId": payload["matchId"],
            "opponentProfile": "Bloque medio y salida corta.",
            "threats": "Extremos atacan el segundo palo.",
            "setPieces": "Vigilar el rebote frontal.",
            "matchGoals": "Ganar segunda jugada y atacar espalda.",
            "checklist": [{"id": "press", "label": "Acordar gatillos de presion", "checked": True}],
        }
        plan = self.client.put(f"/api/match-reports/{payload['matchId']}/plan", json=plan_payload)
        self.assertEqual(plan.status_code, 200)
        self.assertTrue(plan.json()["checklist"][0]["checked"])
        loaded_plan = self.client.get(f"/api/match-reports/{payload['matchId']}/plan")
        self.assertEqual(loaded_plan.json()["matchGoals"], plan_payload["matchGoals"])
        history_with_plan = self.client.get("/api/match-history")
        self.assertEqual(history_with_plan.json()[0]["matchPlan"]["opponentProfile"], plan_payload["opponentProfile"])

        event = self.client.post(
            f"/api/match-reports/{payload['matchId']}/events",
            json={"type": "adjustment", "minute": 54, "note": "Subir presion tras saque de puerta."},
        )
        self.assertEqual(event.status_code, 201)
        events = self.client.get(f"/api/match-reports/{payload['matchId']}/events")
        self.assertEqual(events.json()[0]["minute"], 54)
        history_with_event = self.client.get("/api/match-history")
        self.assertEqual(history_with_event.json()[0]["eventCount"], 1)
        self.assertEqual(self.client.delete(f"/api/match-reports/{payload['matchId']}/events/{event.json()['id']}").status_code, 200)

        callup = self.client.put(
            f"/api/match-reports/{payload['matchId']}/callups",
            json={"rosterKey": "custom:ricky", "name": "Ricky", "number": 10, "status": "called", "note": "Llega a las 21:15."},
        )
        self.assertEqual(callup.status_code, 200)
        self.assertEqual(callup.json()["status"], "called")
        callups = self.client.get(f"/api/match-reports/{payload['matchId']}/callups")
        self.assertEqual(callups.json()[0]["rosterKey"], "custom:ricky")
        history_with_callup = self.client.get("/api/match-history")
        self.assertEqual(history_with_callup.json()[0]["callupCount"], 1)
        self.assertEqual(self.client.delete(f"/api/match-reports/{payload['matchId']}/callups/custom%3Aricky").status_code, 200)

    def test_opponent_profile_is_saved_and_normalized(self) -> None:
        payload = {
            "name": "  Rival FC  ", "formation": "4-2-3-1", "playStyle": "Bloque medio y salida corta.",
            "strengths": "Extremos rapidos.", "weaknesses": "Espalda de laterales.",
            "setPieces": "Carga el primer palo.", "playerNotes": "El MCO recibe entre lineas.", "tags": ["presion", "transicion"],
        }
        saved = self.client.put("/api/opponent-profiles", json=payload)
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()["name"], "Rival FC")
        self.assertEqual(saved.json()["playStyle"], payload["playStyle"])

        updated = {**payload, "name": "rival fc", "formation": "4-3-3"}
        self.assertEqual(self.client.put("/api/opponent-profiles", json=updated).status_code, 200)
        listed = self.client.get("/api/opponent-profiles")
        self.assertEqual(len(listed.json()), 1)
        self.assertEqual(listed.json()[0]["formation"], "4-3-3")

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

    def test_lineup_template_crud(self) -> None:
        payload = {
            "name": "Once de presion",
            "formation": "4-2-3-1",
            "players": [{
                "rosterKey": "custom:ricky",
                "name": "Ricky",
                "number": 10,
                "positionLabel": "MCO",
                "avatarUrl": "/uploads/ricky.webp",
                "position": {"x": 58, "y": 34, "z": 0},
            }],
        }
        created = self.client.post("/api/tactical-lineup-templates", json=payload)
        self.assertEqual(created.status_code, 201)
        template = created.json()
        self.assertEqual(template["formation"], "4-2-3-1")
        self.assertEqual(template["players"][0]["rosterKey"], "custom:ricky")

        listed = self.client.get("/api/tactical-lineup-templates")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()[0]["id"], template["id"])

        deleted = self.client.delete(f"/api/tactical-lineup-templates/{template['id']}")
        self.assertEqual(deleted.status_code, 200)

    def test_play_template_crud(self) -> None:
        payload = {
            "name": "Salida 3+2",
            "category": "Salida de balon",
            "description": "Atraer la presion y liberar al pivote.",
            "document": self.payload()["document"],
        }
        created = self.client.post("/api/tactical-play-templates", json=payload)
        self.assertEqual(created.status_code, 201)
        template = created.json()
        self.assertEqual(template["document"]["schemaVersion"], 4)

        listed = self.client.get("/api/tactical-play-templates")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()[0]["name"], payload["name"])

        loaded = self.client.get(f"/api/tactical-play-templates/{template['id']}")
        self.assertEqual(loaded.json()["description"], payload["description"])
        deleted = self.client.delete(f"/api/tactical-play-templates/{template['id']}")
        self.assertEqual(deleted.status_code, 200)


if __name__ == "__main__":
    unittest.main()
