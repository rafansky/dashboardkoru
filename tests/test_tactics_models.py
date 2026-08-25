import unittest

from pydantic import ValidationError

from app.tactics_models import TacticalBoardDocument


class TacticalDocumentTests(unittest.TestCase):
    def document(self) -> dict:
        return {
            "schemaVersion": 1,
            "pitch": {"width": 105, "height": 68},
            "teams": [
                {"id": "home", "name": "KORU", "primaryColor": "#f95516", "secondaryColor": "#ffffff"}
            ],
            "entities": [
                {
                    "id": "player-1",
                    "type": "player",
                    "teamId": "home",
                    "name": "Ricky",
                    "number": 8,
                    "position": {"x": 42, "y": 34},
                }
            ],
            "scenes": [
                {
                    "id": "scene-1",
                    "name": "Salida",
                    "entityStates": [{"entityId": "player-1", "position": {"x": 45, "y": 34}}],
                }
            ],
        }

    def test_document_round_trip_uses_public_aliases(self) -> None:
        document = TacticalBoardDocument.model_validate(self.document())
        serialized = document.model_dump(by_alias=True)
        self.assertEqual(serialized["schemaVersion"], 1)
        self.assertEqual(serialized["entities"][0]["teamId"], "home")
        self.assertEqual(serialized["scenes"][0]["entityStates"][0]["entityId"], "player-1")

    def test_entity_outside_pitch_is_rejected(self) -> None:
        payload = self.document()
        payload["entities"][0]["position"]["x"] = 106
        with self.assertRaises(ValidationError):
            TacticalBoardDocument.model_validate(payload)

    def test_missing_entity_reference_is_rejected(self) -> None:
        payload = self.document()
        payload["scenes"][0]["entityStates"][0]["entityId"] = "missing"
        with self.assertRaises(ValidationError):
            TacticalBoardDocument.model_validate(payload)


if __name__ == "__main__":
    unittest.main()
