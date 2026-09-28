"""Captain workspace. Versioned records preserve day history and reject stale edits."""
import json
import sqlite3
import uuid
from contextlib import closing
from datetime import date, datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from . import storage
from .services.dashboard import dashboard_service
from .settings import STATIC_DIR

router = APIRouter()


def init_squad():
    with closing(sqlite3.connect(storage.DB_PATH)) as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS squad_records (kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(kind,id))")
        conn.execute("CREATE TABLE IF NOT EXISTS squad_audit (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, record_id TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL)")
        conn.commit()


class Record(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    version: int = Field(default=0, ge=0)


class Player(Record):
    name: str = Field(min_length=1, max_length=80)
    alias: str = Field(default="", max_length=80)
    number: int = Field(default=0, ge=0, le=99)
    position: str = Field(default="LIBRE", max_length=24)
    secondary: str = Field(default="", max_length=80)
    status: Literal["active", "trial", "inactive"] = "active"
    birthday: str = ""
    region: str = Field(default="", max_length=80)
    twitter: str = Field(default="", max_length=80)
    contact: str = Field(default="", max_length=160)
    notes: str = Field(default="", max_length=3000)
    avatarUrl: str = Field(default="", max_length=700)
    sourceKey: str = Field(default="", max_length=180)

    @field_validator("birthday")
    @classmethod
    def birthday_valid(cls, value):
        if value:
            date.fromisoformat(value)
        return value

    @field_validator("avatarUrl")
    @classmethod
    def avatar_valid(cls, value):
        if value and not value.startswith(("https://", "/uploads/", "/assets/", "/imageneskoru/")):
            raise ValueError("Usa una imagen HTTPS o subida al archivo")
        return value


class ResponseRow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    availability: Literal["pending", "available", "maybe", "unavailable"] = "pending"
    attendance: Literal["pending", "present", "late", "excused", "absent"] = "pending"
    participation: Literal["pending", "played", "not_played"] = "pending"
    note: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def participation_consistent(self):
        if self.participation == "played" and self.attendance not in {"present", "late"}:
            raise ValueError("Para registrar que jugo, marca su asistencia como presente o tarde")
        return self


class Fixture(BaseModel):
    time: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    opponent: str = Field(min_length=1, max_length=100)
    competition: str = Field(default="", max_length=80)
    owner: str = Field(default="", max_length=80)
    done: bool = False


class Day(Record):
    formation: Literal["4-3-3", "4-2-3-1", "3-5-2", "3-1-4-2", "4-4-2"] = "4-3-3"
    lineup: list[str | None] = Field(default_factory=lambda: [None] * 11, min_length=11, max_length=11)
    responses: dict[str, ResponseRow] = Field(default_factory=dict, max_length=300)
    fixtures: list[Fixture] = Field(default_factory=list, max_length=30)
    notes: str = Field(default="", max_length=3000)

    @model_validator(mode="after")
    def unique_lineup(self):
        ids = [p for p in self.lineup if p]
        if len(set(ids)) != len(ids):
            raise ValueError("Un jugador no puede ocupar dos puestos")
        for pid in ids:
            if self.responses.get(pid, ResponseRow()).availability == "unavailable":
                raise ValueError("El once contiene un jugador no disponible")
        return self


class Candidate(Record):
    name: str = Field(min_length=1, max_length=80)
    twitter: str = Field(default="", max_length=80)
    position: str = Field(default="", max_length=24)
    team: str = Field(default="", max_length=80)
    archetype: str = Field(default="", max_length=80)
    status: Literal["pending", "contacted", "scheduled", "staff", "player", "accepted", "rejected"] = "pending"
    rating: int | None = Field(default=None, ge=1, le=5)
    trialDate: date | None = None
    notes: str = Field(default="", max_length=3000)


class PlayerAnnotation(Record):
    player_id: str = Field(alias="playerId", min_length=1, max_length=80)
    body: str = Field(min_length=1, max_length=1200)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), alias="createdAt")


def _player_by_id(player_id: str) -> dict:
    player = next((item for item in records("player") if item["id"] == player_id), None)
    if not player:
        raise HTTPException(404, "Jugador no encontrado")
    return player


def _player_key(value: str | None) -> str:
    return "".join(char for char in str(value or "").casefold() if char.isalnum())


def _attendance_profile(player_id: str) -> dict:
    entries = []
    for item in records("day"):
        response = item.get("responses", {}).get(player_id)
        called = player_id in item.get("lineup", [])
        if not response and not called:
            continue
        row = {"date": item["id"], "called": called, **(response or {})}
        entries.append(row)
    entries.sort(key=lambda item: item["date"], reverse=True)
    present = sum(item.get("attendance") in {"present", "late"} for item in entries)
    absent = sum(item.get("attendance") in {"absent", "excused"} for item in entries)
    bench = sum(item.get("attendance") in {"present", "late"} and item.get("participation") == "not_played" for item in entries)
    played = sum(item.get("participation") == "played" for item in entries)
    return {
        "summary": {"markedDays": len(entries), "present": present, "absent": absent, "bench": bench, "played": played, "called": sum(item["called"] for item in entries)},
        "history": entries[:30],
    }


async def _league_profile(player: dict) -> dict | None:
    dashboard = await dashboard_service.get_dashboard()
    candidates = dashboard.get("analytics", {}).get("playerElo", [])
    aliases = {_player_key(player.get("name")), _player_key(player.get("alias"))}
    source_key = str(player.get("sourceKey") or "")
    if source_key.startswith("dashboard:"):
        aliases.add(_player_key(source_key.split(":", 1)[1]))
    stats = next((item for item in candidates if _player_key(item.get("username")) in aliases), None)
    if not stats:
        return None
    return {
        **stats,
        "source": "VPG",
        "sourceUrl": next((item["url"] for item in dashboard.get("sources", []) if item.get("label") == "Perfil VPG"), ""),
        "updatedAt": dashboard.get("updatedAt"),
        "stale": bool(dashboard.get("stale")),
    }


def decode(row):
    return {**json.loads(row[1]), "id": row[0], "version": row[2], "updatedAt": row[3]}


def records(kind):
    with closing(sqlite3.connect(storage.DB_PATH)) as conn:
        return [decode(row) for row in conn.execute("SELECT id,payload,version,updated_at FROM squad_records WHERE kind=? ORDER BY id", (kind,))]


def persist(kind, rid, model, create=False):
    payload = model.model_dump(mode="json", by_alias=True, exclude={"version"})
    with closing(sqlite3.connect(storage.DB_PATH)) as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT version,payload FROM squad_records WHERE kind=? AND id=?", (kind, rid)).fetchone()
        if not row and not create:
            raise HTTPException(404, "Registro no encontrado")
        version = row[0] if row else 0
        if version != model.version:
            raise HTTPException(409, "Otra persona ha actualizado estos datos. Recarga antes de guardar.")
        if kind == "day":
            known = {r["id"]: r for r in records("player")}
            for pid in set(payload["responses"]) | {p for p in payload["lineup"] if p}:
                if pid not in known:
                    raise HTTPException(422, "Jugador desconocido")
            previous_lineup = json.loads(row[1]).get("lineup", []) if row else []
            if any(known[p]["status"] == "inactive" and p not in previous_lineup for p in payload["lineup"] if p):
                raise HTTPException(422, "No puedes alinear un jugador inactivo")
        if kind == "player" and payload.get("sourceKey"):
            if any(p["id"] != rid and p.get("sourceKey") == payload["sourceKey"] for p in records("player")):
                raise HTTPException(409, "Ese jugador ya esta incorporado")
        now = datetime.now(timezone.utc).isoformat()
        encoded = json.dumps(payload, ensure_ascii=False)
        conn.execute("INSERT INTO squad_records VALUES (?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload,version=excluded.version,updated_at=excluded.updated_at", (kind, rid, encoded, version + 1, now))
        conn.execute("INSERT INTO squad_audit(kind,record_id,payload,created_at) VALUES (?,?,?,?)", (kind, rid, encoded, now))
        conn.commit()
    return {**payload, "id": rid, "version": version + 1, "updatedAt": now}


@router.get("/gestion-plantilla")
def page():
    return FileResponse(STATIC_DIR / "squad.html")


@router.get("/api/squad/players")
def players():
    return records("player")


@router.post("/api/squad/players", status_code=201)
def add_player(payload: Player):
    return persist("player", uuid.uuid4().hex, payload, create=True)


@router.put("/api/squad/players/{pid}")
def edit_player(pid: str, payload: Player):
    return persist("player", pid, payload)


@router.get("/api/squad/players/{pid}/profile")
async def player_profile(pid: str):
    player = _player_by_id(pid)
    annotations = [item for item in records("player_note") if item.get("playerId") == pid]
    annotations.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
    return {
        "player": player,
        "attendance": _attendance_profile(pid),
        "annotations": annotations,
        "league": await _league_profile(player),
    }


@router.post("/api/squad/players/{pid}/annotations", status_code=201)
def add_player_annotation(pid: str, payload: PlayerAnnotation):
    _player_by_id(pid)
    if payload.player_id != pid:
        raise HTTPException(400, "La anotacion no corresponde al jugador")
    return persist("player_note", uuid.uuid4().hex, payload, create=True)


@router.delete("/api/squad/players/{pid}/annotations/{annotation_id}")
def delete_player_annotation(pid: str, annotation_id: str):
    annotation = next((item for item in records("player_note") if item["id"] == annotation_id), None)
    if not annotation or annotation.get("playerId") != pid:
        raise HTTPException(404, "Anotacion no encontrada")
    with closing(sqlite3.connect(storage.DB_PATH)) as conn:
        deleted = conn.execute("DELETE FROM squad_records WHERE kind = ? AND id = ?", ("player_note", annotation_id)).rowcount
        conn.commit()
    return {"deleted": bool(deleted)}


@router.get("/api/squad/days")
def days(month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")):
    return [r for r in records("day") if r["id"].startswith(month)]


@router.get("/api/squad/days/{day}")
def get_day(day: date):
    return next((r for r in records("day") if r["id"] == day.isoformat()), {**Day().model_dump(), "id": day.isoformat()})


@router.put("/api/squad/days/{day}")
def save_day(day: date, payload: Day):
    return persist("day", day.isoformat(), payload, create=True)


@router.get("/api/squad/candidates")
def candidates():
    return records("candidate")


@router.post("/api/squad/candidates", status_code=201)
def add_candidate(payload: Candidate):
    return persist("candidate", uuid.uuid4().hex, payload, create=True)


@router.put("/api/squad/candidates/{cid}")
def edit_candidate(cid: str, payload: Candidate):
    return persist("candidate", cid, payload)
