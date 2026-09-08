import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("KORU_ACCESS_PASSWORD", "test-password")
from fastapi.testclient import TestClient
from app.main import app
from app import storage
from app.squad import init_squad


class SquadTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = patch.object(storage, "DB_PATH", Path(self.tmp.name) / "test.db")
        self.db.start()
        init_squad()
        self.client = TestClient(app)
        self.client.post("/api/login", data={"password": "test-password"})

    def tearDown(self):
        self.client.close()
        self.db.stop()
        self.tmp.cleanup()

    def test_auth_and_validation(self):
        with TestClient(app) as anon:
            self.assertEqual(anon.get("/api/squad/players").status_code, 401)
        for value in ({"name": "  "}, {"name": "Rafa", "number": 100}, {"name": "Rafa", "birthday": "bad"}, {"name": "Rafa", "avatarUrl": "javascript:alert(1)"}):
            self.assertEqual(self.client.post("/api/squad/players", json=value).status_code, 422)

    def test_roster_and_daily_history(self):
        p = self.client.post("/api/squad/players", json={"name": "Rafa", "sourceKey": "custom:r"}).json()
        self.assertEqual(self.client.post("/api/squad/players", json={"name": "Rafa", "sourceKey": "custom:r"}).status_code, 409)
        day = self.client.get("/api/squad/days/2026-09-08").json()
        day.pop("id")
        day["lineup"][0] = p["id"]
        day["responses"] = {p["id"]: {"availability": "available", "attendance": "absent"}}
        saved = self.client.put("/api/squad/days/2026-09-08", json=day)
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(self.client.put("/api/squad/days/2026-09-08", json=day).status_code, 409)
        stored = self.client.get("/api/squad/days?month=2026-09").json()[0]
        self.assertEqual(stored["responses"][p["id"]]["attendance"], "absent")
        self.assertEqual(stored["responses"][p["id"]]["availability"], "available")
        update = {k: v for k, v in p.items() if k not in ("id", "updatedAt")}
        update["status"] = "inactive"
        self.assertEqual(self.client.put("/api/squad/players/" + p["id"], json=update).status_code, 200)
        self.assertEqual(self.client.get("/api/squad/days/2026-09-08").json()["lineup"][0], p["id"])
        correction = {k: v for k, v in stored.items() if k not in ("id", "updatedAt")}
        correction["notes"] = "Nota historica corregida"
        self.assertEqual(self.client.put("/api/squad/days/2026-09-08", json=correction).status_code, 200)
        self.assertEqual(self.client.put("/api/squad/days/2026-09-10", json={"lineup": [p["id"]] + [None] * 10}).status_code, 422)

    def test_lineup_integrity_and_candidates(self):
        p = self.client.post("/api/squad/players", json={"name": "Andy"}).json()
        for lineup, responses in [([p["id"], p["id"]] + [None] * 9, {}), (["unknown"] + [None] * 10, {}), ([p["id"]] + [None] * 10, {p["id"]: {"availability": "unavailable"}})]:
            r = self.client.put("/api/squad/days/2026-09-09", json={"lineup": lineup, "responses": responses})
            self.assertEqual(r.status_code, 422, r.text)
        c = self.client.post("/api/squad/candidates", json={"name": "Prueba", "status": "scheduled", "trialDate": "2026-09-12", "rating": 4}).json()
        self.assertEqual(self.client.get("/api/squad/candidates").json()[0]["id"], c["id"])
        self.assertEqual(self.client.put("/api/squad/days/not-a-date", json={}).status_code, 422)

    def test_participation_is_explicit_and_persisted(self):
        p = self.client.post("/api/squad/players", json={"name": "Calendario"}).json()
        r = {"availability": "available", "attendance": "present", "participation": "not_played", "note": "Disponible, rotacion del equipo"}
        saved = self.client.put("/api/squad/days/2026-09-12", json={"responses": {p["id"]: r}})
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(self.client.get("/api/squad/days/2026-09-12").json()["responses"][p["id"]], r)
        invalid = {**r, "attendance": "absent", "participation": "played"}
        self.assertEqual(self.client.put("/api/squad/days/2026-09-13", json={"responses": {p["id"]: invalid}}).status_code, 422)
        legacy = self.client.put("/api/squad/days/2026-09-14", json={"responses": {p["id"]: {"attendance": "present"}}}).json()
        self.assertEqual(legacy["responses"][p["id"]]["participation"], "pending")
