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
        self.assertEqual(serialized["schemaVersion"], 4)
        self.assertIn("analysis", serialized)
        self.assertEqual(serialized["scenes"][0]["annotations"], [])
        self.assertEqual(serialized["scenes"][0]["movementPaths"], [])
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

    def test_duplicate_and_out_of_bounds_scene_states_are_rejected(self) -> None:
        payload = self.document()
        payload["scenes"][0]["entityStates"].append(
            {"entityId": "player-1", "position": {"x": 45, "y": 34}}
        )
        with self.assertRaises(ValidationError):
            TacticalBoardDocument.model_validate(payload)

    def test_movement_paths_require_existing_entities_and_stay_on_pitch(self) -> None:
        payload = self.document()
        payload["scenes"][0]["movementPaths"] = [{
            "id": "path-1", "entityId": "player-1", "points": [{"x": 42, "y": 34}, {"x": 70, "y": 42}],
        }]
        document = TacticalBoardDocument.model_validate(payload)
        self.assertEqual(len(document.scenes[0].movement_paths), 1)

        payload["scenes"][0]["movementPaths"][0]["entityId"] = "missing"
        with self.assertRaises(ValidationError):
            TacticalBoardDocument.model_validate(payload)

    def test_duplicate_team_scene_and_annotation_ids_are_rejected(self) -> None:
        payload = self.document()
        payload["teams"].append(dict(payload["teams"][0]))
        with self.assertRaises(ValidationError):
            TacticalBoardDocument.model_validate(payload)

        payload = self.document()
        payload["scenes"].append(dict(payload["scenes"][0]))
        with self.assertRaises(ValidationError):
            TacticalBoardDocument.model_validate(payload)

        payload = self.document()
        annotation = {
            "id": "arrow-1",
            "type": "arrow",
            "start": {"x": 20, "y": 20},
            "end": {"x": 40, "y": 30},
        }
        payload["scenes"][0]["annotations"] = [annotation, dict(annotation)]
        with self.assertRaises(ValidationError):
            TacticalBoardDocument.model_validate(payload)

        payload = self.document()
        payload["scenes"][0]["entityStates"][0]["position"]["x"] = 106
        with self.assertRaises(ValidationError):
            TacticalBoardDocument.model_validate(payload)


if __name__ == "__main__":
    unittest.main()
