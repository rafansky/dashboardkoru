import tempfile
import unittest
from pathlib import Path

import app.storage as storage


class TacticalStorageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.original_paths = (storage.DATA_DIR, storage.UPLOAD_DIR, storage.DB_PATH)
        storage.DATA_DIR = root / "data"
        storage.UPLOAD_DIR = root / "uploads"
        storage.DB_PATH = storage.DATA_DIR / "test.db"
        storage.init_storage()

    def tearDown(self) -> None:
        storage.DATA_DIR, storage.UPLOAD_DIR, storage.DB_PATH = self.original_paths
        self.temp_dir.cleanup()

    def payload(self) -> dict:
        return {
            "name": "Salida 4-3-3",
            "description": "Preparacion",
            "category": "Ataque",
            "teamId": "koru-eclub",
            "author": "KORU",
            "favorite": False,
            "document": {"schemaVersion": 1, "pitch": {"width": 105, "height": 68}},
        }

    def test_create_list_update_and_optimistic_version(self) -> None:
        board = storage.create_tactical_board(self.payload())
        self.assertEqual(board["version"], 1)
        self.assertEqual(storage.list_tactical_boards()[0]["id"], board["id"])

        update = {**self.payload(), "name": "Salida editada", "version": 1}
        saved = storage.update_tactical_board(board["id"], update)
        self.assertIsNotNone(saved)
        self.assertEqual(saved["version"], 2)
        self.assertEqual(saved["name"], "Salida editada")
        self.assertIsNone(storage.update_tactical_board(board["id"], update))

        self.assertTrue(storage.delete_tactical_board(board["id"]))
        self.assertIsNone(storage.get_tactical_board(board["id"]))

    def test_match_report_upsert(self) -> None:
        report = storage.upsert_match_report({
            "matchId": "plg-10",
            "opponent": "Rival",
            "competition": "PLG",
            "status": "pre-match",
            "lineup": ["Ricky"],
            "summary": "",
            "takeaways": "",
            "tags": ["scouting"],
        })
        self.assertEqual(report["matchId"], "plg-10")
        self.assertEqual(storage.get_match_report("plg-10")["tags"], ["scouting"])


if __name__ == "__main__":
    unittest.main()
