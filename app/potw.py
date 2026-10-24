"""VPN importer, persistent weekly awards and personal, single-player ballots."""
import argparse
import asyncio
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import sqlite3
from contextlib import closing
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import storage
from .potw_scoring import MADRID, rank_week, results, week_of
from .settings import STATIC_DIR

router = APIRouter()
log = logging.getLogger(__name__)
BASE = "https://virtualpronetwork.com"
TEAM = 29377
DEFAULT_SEASON = "/es/league/2215/3a-division-b-plg/season/6427/standings"
_sync_lock = asyncio.Lock()
_last_attempt = None


def now():
    return datetime.now(timezone.utc)


def connection():
    conn = sqlite3.connect(storage.DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    return conn


def init_potw():
    storage.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with closing(connection()) as conn, conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS potw_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS potw_fixtures (
          id INTEGER PRIMARY KEY, week TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS potw_reports (
          id INTEGER PRIMARY KEY, payload TEXT NOT NULL, fetched_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS potw_weeks (
          week TEXT PRIMARY KEY, status TEXT NOT NULL, snapshot TEXT NOT NULL,
          opened_at TEXT NOT NULL, closes_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS potw_voters (
          week TEXT NOT NULL, player_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
          PRIMARY KEY (week, player_id));
        CREATE TABLE IF NOT EXISTS potw_ballots (
          week TEXT NOT NULL, player_id TEXT NOT NULL, choices TEXT NOT NULL, updated_at TEXT NOT NULL,
          PRIMARY KEY (week, player_id));
        """)
        conn.execute("INSERT OR IGNORE INTO potw_meta VALUES ('manager_key', ?)", (secrets.token_urlsafe(32),))
        conn.execute("INSERT OR IGNORE INTO potw_meta VALUES ('season_path', ?)", (DEFAULT_SEASON,))


def meta(key, default=None):
    with closing(connection()) as conn:
        row = conn.execute("SELECT value FROM potw_meta WHERE key=?", (key,)).fetchone()
    return row[0] if row else default


def manager(key):
    expected = os.getenv("KORU_POTW_MANAGER_KEY") or meta("manager_key", "")
    if not key or not expected or not hmac.compare_digest(key, expected):
        raise HTTPException(403, "Clave de capitán incorrecta")


def parse_page(html):
    match = re.search(r'<script\b[^>]*\bid=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>', html, re.S)
    if not match:
        raise ValueError("VPN no devuelve los datos esperados")
    return json.loads(match.group(1))["props"]["pageProps"]


async def fetch_page(client, path):
    response = await client.get(BASE + path)
    response.raise_for_status()
    if len(response.content) > 12 * 1024 * 1024:
        raise ValueError("Respuesta VPN demasiado grande")
    return parse_page(response.text)


def extract_fixtures(page):
    row = next((r for r in page.get("table", []) if r.get("tid") == TEAM), None)
    if not row or not row.get("matches"):
        raise ValueError("No se encuentra el calendario de KORU en la temporada")
    fixtures = []
    for raw in row["matches"]:
        if TEAM not in (raw.get("team1"), raw.get("team2")):
            raise ValueError("El calendario contiene un partido de otro equipo")
        other = raw.get("awayTeam" if raw["team1"] == TEAM else "homeTeam") or {}
        fixtures.append(dict(id=int(raw["id"]), round=int(raw["round"]), date=raw["date"],
                             published=bool(raw["published"]), forfeit=bool(raw.get("forfeit")),
                             opponent=other.get("name", "Rival"), season=int(raw["season"]),
                             competition=(page.get("league") or {}).get("name", "Liga VPN")))
    if len({f["id"] for f in fixtures}) != len(fixtures):
        raise ValueError("VPN devuelve partidos duplicados")
    return fixtures


def validate_report(report, fixture):
    if int(report["match"]["id"]) != fixture["id"] or int(report["competition"]["seasonId"]) != fixture["season"]:
        raise ValueError("Informe de otro partido o temporada")
    if TEAM not in (report["home"]["teamId"], report["away"]["teamId"]):
        raise ValueError("Informe de otro equipo")
    for key in ("home", "away"):
        ids = [str(p["userId"]) for p in report[key]["players"]]
        if len(ids) != len(set(ids)):
            raise ValueError("Jugadores duplicados en un informe")


async def sync_vpn():
    """One worker per process; bounded requests and preserved data on source errors."""
    global _last_attempt
    async with _sync_lock:
        # Button spam and multiple tabs must not hammer the source.
        if _last_attempt and (now() - _last_attempt).total_seconds() < 60:
            return {"message": "La última comprobación es reciente", "syncedAt": meta("synced_at")}
        _last_attempt = now()
        warnings = []
        path = meta("season_path", DEFAULT_SEASON)
        try:
            async with httpx.AsyncClient(timeout=30, follow_redirects=True,
                                         headers={"User-Agent": "Mozilla/5.0 (compatible; KoruDashboard/1.0)"}) as client:
                # Discover the active league season from the club once daily.
                discovered = meta("discovered_at")
                if not discovered or (now() - datetime.fromisoformat(discovered)).total_seconds() >= 86400:
                    try:
                        team_page = await fetch_page(client, "/es/teams/koru-eclub")
                        competitions = [c for c in team_page.get("general", {}).get("competitions", []) if c.get("kind") == "league"]
                        current_id = int(path.split("/")[3])
                        chosen = next((c for c in competitions if c["id"] == current_id), None)
                        if chosen is None and len(competitions) == 1:
                            chosen = competitions[0]
                        if chosen and re.fullmatch(r"/es/league/\d+/[a-z0-9-]+/season/\d+/standings", chosen.get("href", "")):
                            path = chosen["href"]
                            with closing(connection()) as conn, conn:
                                conn.execute("INSERT OR REPLACE INTO potw_meta VALUES ('season_path', ?)", (path,))
                                conn.execute("INSERT OR REPLACE INTO potw_meta VALUES ('discovered_at', ?)", (now().isoformat(),))
                    except Exception as exc:
                        log.warning("POTW season discovery (using known season): %s", exc)
                fixtures = extract_fixtures(await fetch_page(client, path))
                # Keep the first assigned week even if VPN moves a postponed game.
                with closing(connection()) as conn, conn:
                    for f in fixtures:
                        conn.execute("INSERT INTO potw_fixtures VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
                                     (f["id"], week_of(f["date"]), json.dumps(f)))
                semaphore = asyncio.Semaphore(3)

                async def load(fixture):
                    if not fixture["published"] or fixture["forfeit"]:
                        return
                    with closing(connection()) as conn:
                        saved = conn.execute("SELECT fetched_at FROM potw_reports WHERE id=?", (fixture["id"],)).fetchone()
                        week = conn.execute("SELECT week FROM potw_fixtures WHERE id=?", (fixture["id"],)).fetchone()[0]
                    age = now() - datetime.fromisoformat(fixture["date"].replace("Z", "+00:00"))
                    # Reconcile the recent fortnight; older reports are cached daily.
                    if saved and age.days > 14 and (now() - datetime.fromisoformat(saved[0])).total_seconds() < 86400:
                        return
                    async with semaphore:
                        try:
                            report = (await fetch_page(client, f"/es/matches/{fixture['id']}"))["report"]
                            validate_report(report, fixture)
                            with closing(connection()) as conn, conn:
                                conn.execute("INSERT INTO potw_reports VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at",
                                             (fixture["id"], json.dumps(report), now().isoformat()))
                        except Exception as exc:
                            warnings.append(f"J{fixture['round']}: no se pudo actualizar el informe")
                            log.warning("POTW report %s: %s", fixture["id"], exc)
                await asyncio.gather(*(load(f) for f in fixtures))
            with closing(connection()) as conn, conn:
                for key, value in (("synced_at", now().isoformat()), ("warnings", json.dumps(warnings))):
                    conn.execute("INSERT OR REPLACE INTO potw_meta VALUES (?, ?)", (key, value))
            advance_weeks()
            return {"message": "Calendario y estadísticas actualizados", "syncedAt": meta("synced_at"), "warnings": warnings}
        except Exception as exc:
            log.warning("POTW sync: %s", exc)
            with closing(connection()) as conn, conn:
                conn.execute("INSERT OR REPLACE INTO potw_meta VALUES ('warnings', ?)", (json.dumps(["VPN no está disponible; se conservan los últimos datos. " + str(exc)[:120]]),))
            return {"message": "No se pudo actualizar VPN; se conserva la caché", "warnings": json.loads(meta("warnings", "[]"))}


def source_data():
    with closing(connection()) as conn:
        fixtures = [(r["week"], json.loads(r["payload"])) for r in conn.execute("SELECT * FROM potw_fixtures ORDER BY week, id")]
        reports = {r["id"]: json.loads(r["payload"]) for r in conn.execute("SELECT * FROM potw_reports")}
    return fixtures, reports


def open_week(week, snapshot, instant):
    # Snapshot and electorate freeze together; late source changes cannot move the goalposts.
    if not snapshot["complete"] or sum(p["eligible"] for p in snapshot["players"]) < 2:
        return False
    voters = [p for p in snapshot["players"] if p["appearances"]]
    with closing(connection()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        cursor = conn.execute("INSERT OR IGNORE INTO potw_weeks VALUES (?, 'open', ?, ?, ?)",
                              (week, json.dumps(snapshot), instant.isoformat(), (instant + timedelta(hours=48)).isoformat()))
        if cursor.rowcount:
            for p in voters:
                # Only hashes persist. The captain issues each personal link explicitly.
                conn.execute("INSERT INTO potw_voters VALUES (?, ?, ?)",
                             (week, p["id"], hashlib.sha256(secrets.token_bytes(32)).hexdigest()))
        return bool(cursor.rowcount)


def advance_weeks():
    fixtures, reports = source_data()
    grouped = {}
    for week, fixture in fixtures:
        grouped.setdefault(week, []).append(fixture)
    instant = now()
    for week, group in grouped.items():
        latest = max(datetime.fromisoformat(f["date"].replace("Z", "+00:00")) for f in group)
        # Automatic windows only for recent weeks, after a 12h reporting grace period.
        if latest + timedelta(hours=12) <= instant <= latest + timedelta(days=7):
            open_week(week, rank_week(group, reports, TEAM), instant)
    with closing(connection()) as conn, conn:
        conn.execute("UPDATE potw_weeks SET status='closed' WHERE status='open' AND closes_at<=?", (instant.isoformat(),))


def week_view(week):
    fixtures, reports = source_data()
    group = [f for w, f in fixtures if w == week]
    if not group:
        raise HTTPException(404, "Semana no encontrada")
    current = rank_week(group, reports, TEAM)
    with closing(connection()) as conn:
        row = conn.execute("SELECT * FROM potw_weeks WHERE week=?", (week,)).fetchone()
        ballots = [dict(playerId=r["player_id"], choices=json.loads(r["choices"]))
                   for r in conn.execute("SELECT player_id, choices FROM potw_ballots WHERE week=?", (week,))]
        voters = conn.execute("SELECT count(*) FROM potw_voters WHERE week=?", (week,)).fetchone()[0]
    status = row["status"] if row else ("ready" if current["complete"] else "pending")
    if row and status == "open" and datetime.fromisoformat(row["closes_at"]) <= now():
        with closing(connection()) as conn, conn:
            conn.execute("UPDATE potw_weeks SET status='closed' WHERE week=?", (week,))
        status = "closed"
    snapshot = json.loads(row["snapshot"]) if row else current
    result = results(snapshot, ballots, voters, status == "closed")
    return dict(week=week, status=status, closesAt=row["closes_at"] if row else None,
                competition=group[0].get("competition", "3.ª División B · PLG · Temporada 13"),
                snapshotChanged=bool(row and json.loads(row["snapshot"]) != current),
                statisticalWinners=results(snapshot, [], voters)["winners"],
                **(snapshot | result))


@router.get("/potw")
def potw_page():
    return FileResponse(STATIC_DIR / "potw.html")


@router.get("/potw/vote/{token}")
def vote_page(token: str):
    return FileResponse(STATIC_DIR / "potw.html", headers={"Referrer-Policy": "no-referrer", "Cache-Control": "no-store"})


@router.get("/api/potw")
def overview():
    advance_weeks()
    fixtures, _ = source_data()
    weeks = []
    for week in sorted({w for w, _ in fixtures}, reverse=True):
        view = week_view(week)
        weeks.append({k: view[k] for k in ("week", "status", "closesAt", "complete", "ballots", "voters", "winners")})
    today = now().astimezone(MADRID).date().isoformat()
    past = [w for w in weeks if w["week"] <= today]
    return dict(weeks=weeks, selectedWeek=past[0]["week"] if past else (weeks[-1]["week"] if weeks else None),
                syncedAt=meta("synced_at"), warnings=json.loads(meta("warnings", "[]")), seasonPath=meta("season_path"))


@router.get("/api/potw/weeks/{week}")
def get_week(week: str):
    return week_view(week)


@router.post("/api/potw/sync")
async def refresh():
    return await sync_vpn()


class VotingAction(BaseModel):
    action: str = Field(pattern="^(open|close)$")


@router.post("/api/potw/weeks/{week}/manage")
def manage_week(week: str, body: VotingAction, x_potw_key: str = Header(default="")):
    manager(x_potw_key)
    view = week_view(week)
    if body.action == "open":
        if view["status"] in ("open", "closed"):
            raise HTTPException(409, "Esta semana ya tiene una votación; no se reinicia")
        fixtures, reports = source_data()
        snapshot = rank_week([f for w, f in fixtures if w == week], reports, TEAM)
        if not open_week(week, snapshot, now()):
            raise HTTPException(409, "Faltan informes completos o al menos dos candidatos elegibles")
    else:
        if view["status"] != "open":
            raise HTTPException(409, "La votación no está abierta")
        with closing(connection()) as conn, conn:
            conn.execute("UPDATE potw_weeks SET status='closed' WHERE week=?", (week,))
    return week_view(week)


@router.get("/api/potw/weeks/{week}/voters")
def list_voters(week: str, x_potw_key: str = Header(default="")):
    manager(x_potw_key)
    view = week_view(week)
    with closing(connection()) as conn:
        ids = {r[0] for r in conn.execute("SELECT player_id FROM potw_ballots WHERE week=?", (week,))}
        voters = {r[0] for r in conn.execute("SELECT player_id FROM potw_voters WHERE week=?", (week,))}
    return [dict(id=p["id"], name=p["name"], voted=p["id"] in ids) for p in view["players"] if p["id"] in voters]


@router.post("/api/potw/weeks/{week}/voters/{player_id}/link")
def issue_link(week: str, player_id: str, x_potw_key: str = Header(default="")):
    manager(x_potw_key)
    if week_view(week)["status"] != "open":
        raise HTTPException(409, "La votación no está abierta")
    token = secrets.token_urlsafe(32)
    with closing(connection()) as conn, conn:
        cursor = conn.execute("UPDATE potw_voters SET token_hash=? WHERE week=? AND player_id=?",
                              (hashlib.sha256(token.encode()).hexdigest(), week, player_id))
        if not cursor.rowcount:
            raise HTTPException(404, "Votante no encontrado")
    return {"path": f"/potw/vote/{token}"}


def token_identity(conn, token):
    if not 30 <= len(token) <= 100:
        raise HTTPException(404, "Enlace de votación no válido")
    row = conn.execute("SELECT week, player_id FROM potw_voters WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
    if not row:
        raise HTTPException(404, "Enlace no válido o sustituido por el capitán")
    return row["week"], row["player_id"]


@router.get("/api/potw/ballot/{token}")
def get_ballot(token: str):
    with closing(connection()) as conn:
        week, pid = token_identity(conn, token)
        row = conn.execute("SELECT choices FROM potw_ballots WHERE week=? AND player_id=?", (week, pid)).fetchone()
    view = week_view(week)
    player = next(p for p in view["players"] if p["id"] == pid)
    return dict(week=week, playerId=pid, name=player["name"], status=view["status"], closesAt=view["closesAt"],
                choices=json.loads(row[0]) if row else [],
                winners=[p["name"] for p in view["players"] if p["id"] in view["winners"]] if view["status"] == "closed" else [],
                candidates=[{k: p[k] for k in ("id", "name", "performance", "appearances", "rating")} for p in view["players"] if p["eligible"] and p["id"] != pid])


class Ballot(BaseModel):
    choices: list[str] = Field(min_length=1, max_length=3)


@router.put("/api/potw/ballot/{token}")
def put_ballot(token: str, body: Ballot):
    # The same transaction verifies the deadline and records/replaces the ballot.
    with closing(connection()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        week, pid = token_identity(conn, token)
        row = conn.execute("SELECT * FROM potw_weeks WHERE week=?", (week,)).fetchone()
        if row["status"] != "open" or datetime.fromisoformat(row["closes_at"]) <= now():
            raise HTTPException(409, "La votación ha terminado")
        snapshot = json.loads(row["snapshot"])
        candidates = {p["id"] for p in snapshot["players"] if p["eligible"] and p["id"] != pid}
        if len(body.choices) != min(3, len(candidates)) or len(set(body.choices)) != len(body.choices) or not set(body.choices) <= candidates:
            raise HTTPException(422, "Elige candidatos distintos, sin votarte a ti mismo, en todos los puestos disponibles")
        conn.execute("INSERT INTO potw_ballots VALUES (?, ?, ?, ?) ON CONFLICT(week, player_id) DO UPDATE SET choices=excluded.choices, updated_at=excluded.updated_at",
                     (week, pid, json.dumps(body.choices), now().isoformat()))
    return {"message": "Voto guardado. Puedes cambiarlo hasta el cierre."}


async def worker():
    while True:
        try:
            await sync_vpn()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("POTW background worker")
        await asyncio.sleep(900)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Administración local del Player of the Week")
    parser.add_argument("--manager-key", action="store_true", help="Mostrar la clave privada del capitán")
    parser.add_argument("--sync", action="store_true", help="Sincronizar VPN una vez")
    args = parser.parse_args()
    init_potw()
    if args.manager_key:
        print(os.getenv("KORU_POTW_MANAGER_KEY") or meta("manager_key"))
    if args.sync:
        print(json.dumps(asyncio.run(sync_vpn()), ensure_ascii=False))
