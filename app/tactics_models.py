from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

LATEST_TACTICAL_SCHEMA = 2


def migrate_tactical_document(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload
    migrated = deepcopy(payload)
    version = int(migrated.get("schemaVersion", migrated.get("schema_version", 1)))
    if version > LATEST_TACTICAL_SCHEMA:
        raise ValueError("La pizarra pertenece a una version mas reciente")
    if version == 1:
        migrated.setdefault("analysis", {"activeSessionId": None, "sessions": []})
        migrated["schemaVersion"] = 2
    return migrated


def _to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class TacticalModel(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True, extra="forbid")


class PitchPoint(TacticalModel):
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    z: float = Field(default=0, ge=0)


class PitchConfig(TacticalModel):
    width: float = Field(default=105, gt=0, le=130)
    height: float = Field(default=68, gt=0, le=100)
    view: Literal["full", "half", "attacking-third", "defensive-third", "penalty-area", "corner"] = "full"
    orientation: Literal["left-to-right", "right-to-left", "top-to-bottom", "bottom-to-top"] = "left-to-right"
    surface: Literal["plain", "stripes"] = "stripes"
    overlays: list[Literal["grid", "thirds", "lanes", "five-lanes", "numbered-zones"]] = Field(default_factory=list)


class TeamStyle(TacticalModel):
    id: str
    name: str = Field(min_length=1, max_length=80)
    primary_color: str = Field(alias="primaryColor", pattern=r"^#[0-9a-fA-F]{6}$")
    secondary_color: str = Field(alias="secondaryColor", pattern=r"^#[0-9a-fA-F]{6}$")


class TacticalEntity(TacticalModel):
    id: str
    type: Literal["player", "ball", "cone", "pole", "mini-goal", "goal", "mannequin", "hoop", "ladder", "hurdle", "coach", "referee"]
    team_id: str | None = Field(default=None, alias="teamId")
    name: str = Field(default="", max_length=80)
    number: int | None = Field(default=None, ge=0, le=99)
    position_label: str | None = Field(default=None, alias="positionLabel", max_length=12)
    position: PitchPoint
    rotation: float = 0
    scale: float = Field(default=1, gt=0, le=5)
    opacity: float = Field(default=1, ge=0, le=1)
    locked: bool = False
    visible: bool = True
    metadata: dict[str, Any] = Field(default_factory=dict)


class TacticalDrawing(TacticalModel):
    id: str
    type: Literal["line", "dashed-line", "arrow", "curved-arrow", "double-arrow", "freehand", "text", "distance"]
    points: list[PitchPoint] = Field(min_length=1)
    color: str = Field(default="#ffffff", pattern=r"^#[0-9a-fA-F]{6}$")
    width: float = Field(default=0.45, gt=0, le=5)
    opacity: float = Field(default=1, ge=0, le=1)
    label: str = Field(default="", max_length=240)
    locked: bool = False
    visible: bool = True


class TacticalZone(TacticalModel):
    id: str
    type: Literal["pressing", "superiority", "inferiority", "cover", "defensive-block", "free-space", "target", "danger", "reception", "finishing", "custom"] = "custom"
    shape: Literal["circle", "rectangle", "polygon"]
    points: list[PitchPoint] = Field(min_length=1)
    name: str = Field(default="", max_length=80)
    color: str = Field(default="#f95516", pattern=r"^#[0-9a-fA-F]{6}$")
    opacity: float = Field(default=0.24, ge=0, le=1)
    locked: bool = False
    visible: bool = True


class TacticalGroup(TacticalModel):
    id: str
    name: str = Field(min_length=1, max_length=80)
    entity_ids: list[str] = Field(default_factory=list, alias="entityIds")
    locked: bool = False


class EntityState(TacticalModel):
    entity_id: str = Field(alias="entityId")
    position: PitchPoint
    rotation: float = 0
    scale: float = Field(default=1, gt=0, le=5)
    opacity: float = Field(default=1, ge=0, le=1)


class TacticalScene(TacticalModel):
    id: str
    name: str = Field(min_length=1, max_length=80)
    duration: float = Field(default=3, gt=0, le=120)
    transition: Literal["linear", "ease", "ease-in", "ease-out", "ease-in-out"] = "ease-in-out"
    notes: str = Field(default="", max_length=4000)
    entity_states: list[EntityState] = Field(default_factory=list, alias="entityStates")


class TimelineConfig(TacticalModel):
    mode: Literal["scenes", "advanced"] = "scenes"
    loop: bool = False
    speed: float = Field(default=1, ge=0.25, le=2)


class CameraConfig(TacticalModel):
    preset: Literal["tactical", "tv", "bench", "behind-goal", "top", "isometric", "free"] = "tactical"
    position: PitchPoint = Field(default_factory=lambda: PitchPoint(x=52.5, y=78, z=52))
    target: PitchPoint = Field(default_factory=lambda: PitchPoint(x=52.5, y=34, z=0))
    zoom: float = Field(default=1, gt=0, le=10)
    follow_entity_id: str | None = Field(default=None, alias="followEntityId")


class TacticalSettings(TacticalModel):
    player_style: Literal["card", "circle", "shirt", "marker"] = Field(default="circle", alias="playerStyle")
    snap_to_grid: bool = Field(default=False, alias="snapToGrid")
    show_names: bool = Field(default=True, alias="showNames")
    anonymize_players: bool = Field(default=False, alias="anonymizePlayers")
    attack_direction: Literal["left-to-right", "right-to-left"] = Field(default="left-to-right", alias="attackDirection")


class AnalysisEntry(TacticalModel):
    id: str
    kind: Literal["observation", "decision", "adjustment", "task", "outcome"]
    text: str = Field(min_length=1, max_length=4000)
    author: str = Field(default="KORU", max_length=80)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), alias="createdAt")
    match_minute: int | None = Field(default=None, alias="matchMinute", ge=0, le=180)
    scene_id: str | None = Field(default=None, alias="sceneId", max_length=120)
    entity_ids: list[str] = Field(default_factory=list, alias="entityIds")


class AnalysisSession(TacticalModel):
    id: str
    name: str = Field(min_length=1, max_length=120)
    type: Literal["pre-match", "live", "post-match", "training", "opponent"] = "pre-match"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), alias="createdAt")
    match_id: str | None = Field(default=None, alias="matchId", max_length=120)
    entries: list[AnalysisEntry] = Field(default_factory=list)


class AnalysisWorkspace(TacticalModel):
    active_session_id: str | None = Field(default=None, alias="activeSessionId")
    sessions: list[AnalysisSession] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_active_session(self) -> "AnalysisWorkspace":
        session_ids = [session.id for session in self.sessions]
        if len(session_ids) != len(set(session_ids)):
            raise ValueError("Los IDs de sesiones deben ser unicos")
        if self.active_session_id and self.active_session_id not in set(session_ids):
            raise ValueError("La sesion activa no existe")
        return self


class TacticalBoardDocument(TacticalModel):
    schema_version: int = Field(default=LATEST_TACTICAL_SCHEMA, alias="schemaVersion", ge=LATEST_TACTICAL_SCHEMA, le=LATEST_TACTICAL_SCHEMA)
    pitch: PitchConfig = Field(default_factory=PitchConfig)
    teams: list[TeamStyle] = Field(default_factory=list)
    entities: list[TacticalEntity] = Field(default_factory=list)
    drawings: list[TacticalDrawing] = Field(default_factory=list)
    zones: list[TacticalZone] = Field(default_factory=list)
    groups: list[TacticalGroup] = Field(default_factory=list)
    scenes: list[TacticalScene] = Field(default_factory=list)
    timeline: TimelineConfig = Field(default_factory=TimelineConfig)
    camera: CameraConfig = Field(default_factory=CameraConfig)
    settings: TacticalSettings = Field(default_factory=TacticalSettings)
    analysis: AnalysisWorkspace = Field(default_factory=AnalysisWorkspace)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def migrate_schema(cls, payload: Any) -> Any:
        return migrate_tactical_document(payload)

    @model_validator(mode="after")
    def validate_document_references(self) -> "TacticalBoardDocument":
        entity_ids = [entity.id for entity in self.entities]
        if len(entity_ids) != len(set(entity_ids)):
            raise ValueError("Los IDs de entidades deben ser unicos")

        team_ids = {team.id for team in self.teams}
        for entity in self.entities:
            if entity.position.x > self.pitch.width or entity.position.y > self.pitch.height:
                raise ValueError(f"La entidad {entity.id} esta fuera del campo")
            if entity.team_id and entity.team_id not in team_ids:
                raise ValueError(f"La entidad {entity.id} referencia un equipo inexistente")

        known_entities = set(entity_ids)
        for group in self.groups:
            if not set(group.entity_ids).issubset(known_entities):
                raise ValueError(f"El grupo {group.id} contiene entidades inexistentes")
        for scene in self.scenes:
            if not {state.entity_id for state in scene.entity_states}.issubset(known_entities):
                raise ValueError(f"La escena {scene.id} contiene entidades inexistentes")
        for session in self.analysis.sessions:
            for entry in session.entries:
                if not set(entry.entity_ids).issubset(known_entities):
                    raise ValueError(f"La entrada {entry.id} contiene entidades inexistentes")
        return self


class TacticalBoardCreate(TacticalModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    category: str = Field(default="Ataque", max_length=60)
    match_id: str | None = Field(default=None, max_length=120)
    team_id: str | None = Field(default=None, max_length=120)
    season_id: str | None = Field(default=None, max_length=120)
    author: str = Field(default="KORU", max_length=80)
    favorite: bool = False
    document: TacticalBoardDocument


class TacticalBoardUpdate(TacticalBoardCreate):
    version: int = Field(ge=1)


TACTICAL_POSITIONS = Literal["POR", "LD", "LI", "DFC", "CAD", "CAI", "MCD", "MC", "MD", "MI", "MCO", "ED", "EI", "SD", "DC", "LIBRE"]


class TacticalSquadPlayerCreate(TacticalModel):
    name: str = Field(min_length=1, max_length=80)
    number: int = Field(ge=0, le=99)
    position: TACTICAL_POSITIONS = "LIBRE"
    team: Literal["home", "away"] = "home"
    avatar_url: str | None = Field(default=None, alias="avatarUrl", max_length=700)

    @field_validator("avatar_url")
    @classmethod
    def validate_avatar_url(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        if not (value.startswith("/uploads/") or value.startswith("https://")):
            raise ValueError("La imagen debe ser una subida local o una URL HTTPS")
        return value
