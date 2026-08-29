import sqlite3
import json
import uuid
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import UploadFile

from .settings import DATA_DIR, DB_PATH, UPLOAD_DIR


def init_storage() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                body TEXT NOT NULL,
                author TEXT DEFAULT 'KORU',
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                original_name TEXT NOT NULL,
                stored_name TEXT NOT NULL,
                content_type TEXT,
                size INTEGER NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS elo_snapshots (
                snapshot_date TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_key TEXT NOT NULL,
                label TEXT NOT NULL,
                elo INTEGER NOT NULL,
                payload TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (snapshot_date, entity_type, entity_key)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS tactical_boards (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL DEFAULT 'Ataque',
                match_id TEXT,
                team_id TEXT,
                season_id TEXT,
                author TEXT NOT NULL DEFAULT 'KORU',
                favorite INTEGER NOT NULL DEFAULT 0,
                document_json TEXT NOT NULL,
                thumbnail TEXT,
                version INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_tactical_boards_updated ON tactical_boards(updated_at DESC)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_tactical_boards_match ON tactical_boards(match_id)"
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS tactical_players (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                number INTEGER NOT NULL,
                position TEXT NOT NULL DEFAULT 'LIBRE',
                team TEXT NOT NULL DEFAULT 'home',
                avatar_url TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_tactical_players_team ON tactical_players(team, number)"
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS tactical_lineup_templates (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                formation TEXT NOT NULL DEFAULT '',
                players_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tactical_lineup_templates_updated ON tactical_lineup_templates(updated_at DESC)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS match_reports (
                match_id TEXT PRIMARY KEY,
                opponent TEXT NOT NULL DEFAULT '',
                competition TEXT NOT NULL DEFAULT '',
                match_date TEXT,
                status TEXT NOT NULL DEFAULT 'pre-match',
                score_for INTEGER,
                score_against INTEGER,
                lineup_json TEXT NOT NULL DEFAULT '[]',
                summary TEXT NOT NULL DEFAULT '',
                takeaways TEXT NOT NULL DEFAULT '',
                tags_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_match_reports_updated ON match_reports(updated_at DESC)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS match_report_files (
                match_id TEXT NOT NULL,
                file_id INTEGER NOT NULL,
                attached_at TEXT NOT NULL,
                PRIMARY KEY (match_id, file_id),
                FOREIGN KEY (match_id) REFERENCES match_reports(match_id),
                FOREIGN KEY (file_id) REFERENCES files(id)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_match_report_files_match ON match_report_files(match_id, attached_at DESC)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS match_plans (
                match_id TEXT PRIMARY KEY,
                opponent_profile TEXT NOT NULL DEFAULT '',
                threats TEXT NOT NULL DEFAULT '',
                set_pieces TEXT NOT NULL DEFAULT '',
                match_goals TEXT NOT NULL DEFAULT '',
                checklist_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_match_plans_updated ON match_plans(updated_at DESC)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS match_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                match_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                minute INTEGER,
                note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_match_events_match ON match_events(match_id, created_at DESC)")
        conn.commit()


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {key: row[key] for key in row.keys()}


def list_notes(limit: int = 20) -> list[dict[str, Any]]:
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT id, body, author, created_at FROM notes ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [_row_to_dict(row) for row in rows]


def add_note(body: str, author: str = "KORU") -> dict[str, Any]:
    created_at = datetime.now(timezone.utc).isoformat()
    clean_body = body.strip()
    clean_author = author.strip() or "KORU"
    with closing(sqlite3.connect(DB_PATH)) as conn:
        cursor = conn.execute(
            "INSERT INTO notes (body, author, created_at) VALUES (?, ?, ?)",
            (clean_body, clean_author, created_at),
        )
        conn.commit()
        note_id = cursor.lastrowid
    return {"id": note_id, "body": clean_body, "author": clean_author, "created_at": created_at}


def delete_note(note_id: int) -> bool:
    with closing(sqlite3.connect(DB_PATH)) as conn:
        cursor = conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        conn.commit()
    return cursor.rowcount > 0


def list_files(limit: int = 30) -> list[dict[str, Any]]:
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT id, original_name, stored_name, content_type, size, created_at
            FROM files
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    files = []
    for row in rows:
        item = _row_to_dict(row)
        item["url"] = f"/uploads/{item['stored_name']}"
        files.append(item)
    return files


async def save_upload(file: UploadFile) -> dict[str, Any]:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    original = Path(file.filename or "archivo").name
    suffix = Path(original).suffix[:16]
    stored = f"{uuid.uuid4().hex}{suffix}"
    target = UPLOAD_DIR / stored

    size = 0
    with target.open("wb") as handle:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            handle.write(chunk)

    created_at = datetime.now(timezone.utc).isoformat()
    with closing(sqlite3.connect(DB_PATH)) as conn:
        cursor = conn.execute(
            """
            INSERT INTO files (original_name, stored_name, content_type, size, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (original, stored, file.content_type, size, created_at),
        )
        conn.commit()
        file_id = cursor.lastrowid

    return {
        "id": file_id,
        "original_name": original,
        "stored_name": stored,
        "content_type": file.content_type,
        "size": size,
        "created_at": created_at,
        "url": f"/uploads/{stored}",
    }


def get_previous_elo_snapshot(snapshot_date: str) -> dict[str, int]:
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.row_factory = sqlite3.Row
        previous_date = conn.execute(
            """
            SELECT snapshot_date
            FROM elo_snapshots
            WHERE snapshot_date < ?
            ORDER BY snapshot_date DESC
            LIMIT 1
            """,
            (snapshot_date,),
        ).fetchone()
        if not previous_date:
            return {}
        rows = conn.execute(
            """
            SELECT entity_type, entity_key, elo
            FROM elo_snapshots
            WHERE snapshot_date = ?
            """,
            (previous_date["snapshot_date"],),
        ).fetchall()
    return {f"{row['entity_type']}:{row['entity_key']}": int(row["elo"]) for row in rows}


def upsert_elo_snapshots(snapshot_date: str, snapshots: list[dict[str, Any]]) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.executemany(
            """
            INSERT INTO elo_snapshots (
                snapshot_date, entity_type, entity_key, label, elo, payload, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(snapshot_date, entity_type, entity_key)
            DO UPDATE SET
                label = excluded.label,
                elo = excluded.elo,
                payload = excluded.payload,
                updated_at = excluded.updated_at
            """,
            [
                (
                    item["snapshot_date"],
                    item["entity_type"],
                    item["entity_key"],
                    item["label"],
                    int(item["elo"]),
                    item.get("payload"),
                    now,
                    now,
                )
                for item in snapshots
            ],
        )
        conn.commit()


def get_elo_history(days: int = 14) -> dict[str, list[dict[str, Any]]]:
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.row_factory = sqlite3.Row
        dates = conn.execute(
            """
            SELECT DISTINCT snapshot_date
            FROM elo_snapshots
            ORDER BY snapshot_date DESC
            LIMIT ?
            """,
            (days,),
        ).fetchall()
        selected_dates = [row["snapshot_date"] for row in reversed(dates)]
        if not selected_dates:
            return {}

        placeholders = ",".join("?" for _ in selected_dates)
        rows = conn.execute(
            f"""
            SELECT snapshot_date, entity_type, entity_key, elo
            FROM elo_snapshots
            WHERE snapshot_date IN ({placeholders})
            ORDER BY snapshot_date ASC
            """,
            selected_dates,
        ).fetchall()

    history: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        key = f"{row['entity_type']}:{row['entity_key']}"
        history.setdefault(key, []).append({"date": row["snapshot_date"], "elo": int(row["elo"])})
    return history


def _tactical_board_from_row(row: sqlite3.Row, include_document: bool = True) -> dict[str, Any]:
    board = _row_to_dict(row)
    board["favorite"] = bool(board["favorite"])
    board["matchId"] = board.pop("match_id")
    board["teamId"] = board.pop("team_id")
    board["seasonId"] = board.pop("season_id")
    if include_document:
        board["document"] = json.loads(board.pop("document_json"))
    else:
        board.pop("document_json", None)
    return board


def list_tactical_boards(search: str = "", limit: int = 100) -> list[dict[str, Any]]:
    query = """
        SELECT id, name, description, category, match_id, team_id, season_id, author,
               favorite, thumbnail, version, created_at, updated_at
        FROM tactical_boards
    """
    params: list[Any] = []
    if search.strip():
        query += " WHERE name LIKE ? OR description LIKE ?"
        term = f"%{search.strip()}%"
        params.extend([term, term])
    query += " ORDER BY favorite DESC, updated_at DESC LIMIT ?"
    params.append(max(1, min(limit, 200)))
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(query, params).fetchall()
    return [_tactical_board_from_row(row, include_document=False) for row in rows]


def get_tactical_board(board_id: str) -> dict[str, Any] | None:
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM tactical_boards WHERE id = ?", (board_id,)).fetchone()
    return _tactical_board_from_row(row) if row else None


def create_tactical_board(payload: dict[str, Any]) -> dict[str, Any]:
    board_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    document_json = json.dumps(payload["document"], ensure_ascii=False, separators=(",", ":"))
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.execute(
            """
            INSERT INTO tactical_boards (
                id, name, description, category, match_id, team_id, season_id, author,
                favorite, document_json, thumbnail, version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            """,
            (
                board_id,
                payload["name"],
                payload.get("description", ""),
                payload.get("category", "Ataque"),
                payload.get("matchId"),
                payload.get("teamId"),
                payload.get("seasonId"),
                payload.get("author", "KORU"),
                int(payload.get("favorite", False)),
                document_json,
                payload.get("thumbnail"),
                now,
                now,
            ),
        )
        conn.commit()
    return get_tactical_board(board_id)  # type: ignore[return-value]


def update_tactical_board(board_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    now = datetime.now(timezone.utc).isoformat()
    document_json = json.dumps(payload["document"], ensure_ascii=False, separators=(",", ":"))
    with closing(sqlite3.connect(DB_PATH)) as conn:
        cursor = conn.execute(
            """
            UPDATE tactical_boards
            SET name = ?, description = ?, category = ?, match_id = ?, team_id = ?,
                season_id = ?, author = ?, favorite = ?, document_json = ?, thumbnail = ?,
                version = version + 1, updated_at = ?
            WHERE id = ? AND version = ?
            """,
            (
                payload["name"],
                payload.get("description", ""),
                payload.get("category", "Ataque"),
                payload.get("matchId"),
                payload.get("teamId"),
                payload.get("seasonId"),
                payload.get("author", "KORU"),
                int(payload.get("favorite", False)),
                document_json,
                payload.get("thumbnail"),
                now,
                board_id,
                payload["version"],
            ),
        )
        conn.commit()
    if cursor.rowcount == 0:
        return None
    return get_tactical_board(board_id)


def delete_tactical_board(board_id: str) -> bool:
    with closing(sqlite3.connect(DB_PATH)) as conn:
        cursor = conn.execute("DELETE FROM tactical_boards WHERE id = ?", (board_id,))
        conn.commit()
    return cursor.rowcount > 0


def _match_report_from_row(row: sqlite3.Row) -> dict[str, Any]:
    report = _row_to_dict(row)
    report["matchId"] = report.pop("match_id")
    report["matchDate"] = report.pop("match_date")
    report["scoreFor"] = report.pop("score_for")
    report["scoreAgainst"] = report.pop("score_against")
    report["lineup"] = json.loads(report.pop("lineup_json"))
    report["takeaways"] = report.pop("takeaways")
    report["tags"] = json.loads(report.pop("tags_json"))
    return report


def list_match_reports(limit: int = 100) -> list[dict[str, Any]]:
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT * FROM match_reports ORDER BY COALESCE(match_date, updated_at) DESC LIMIT ?", (max(1, min(limit, 200)),)).fetchall()
    return [_match_report_from_row(row) for row in rows]


def get_match_report(match_id: str) -> dict[str, Any] | None:
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM match_reports WHERE match_id = ?", (match_id,)).fetchone()
    return _match_report_from_row(row) if row else None


def list_match_report_files(match_id: str) -> list[dict[str, Any]]:
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT files.id, files.original_name, files.stored_name, files.content_type, files.size,
                   files.created_at, match_report_files.attached_at
            FROM match_report_files
            JOIN files ON files.id = match_report_files.file_id
            WHERE match_report_files.match_id = ?
            ORDER BY match_report_files.attached_at DESC
            """,
            (match_id,),
        ).fetchall()
    attachments = []
    for row in rows:
        item = _row_to_dict(row)
        item["url"] = f"/uploads/{item['stored_name']}"
        attachments.append(item)
    return attachments


def attach_file_to_match_report(match_id: str, file_id: int) -> dict[str, Any] | None:
    attached_at = datetime.now(timezone.utc).isoformat()
    with closing(sqlite3.connect(DB_PATH)) as conn:
        exists = conn.execute("SELECT 1 FROM files WHERE id = ?", (file_id,)).fetchone()
        if not exists:
            return None
        conn.execute(
            "INSERT OR IGNORE INTO match_report_files (match_id, file_id, attached_at) VALUES (?, ?, ?)",
            (match_id, file_id, attached_at),
        )
        conn.commit()
    return next((item for item in list_match_report_files(match_id) if item["id"] == file_id), None)


def detach_file_from_match_report(match_id: str, file_id: int) -> bool:
    with closing(sqlite3.connect(DB_PATH)) as conn:
        cursor = conn.execute("DELETE FROM match_report_files WHERE match_id = ? AND file_id = ?", (match_id, file_id))
        conn.commit()
    return cursor.rowcount > 0


def _match_plan_from_row(row: sqlite3.Row) -> dict[str, Any]:
    plan = _row_to_dict(row)
    plan["matchId"] = plan.pop("match_id")
    plan["opponentProfile"] = plan.pop("opponent_profile")
    plan["setPieces"] = plan.pop("set_pieces")
    plan["matchGoals"] = plan.pop("match_goals")
    plan["checklist"] = json.loads(plan.pop("checklist_json"))
    return plan


def get_match_plan(match_id: str) -> dict[str, Any] | None:
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM match_plans WHERE match_id = ?", (match_id,)).fetchone()
    return _match_plan_from_row(row) if row else None


def upsert_match_plan(payload: dict[str, Any]) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.execute(
            """
            INSERT INTO match_plans (match_id, opponent_profile, threats, set_pieces, match_goals, checklist_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(match_id) DO UPDATE SET
                opponent_profile = excluded.opponent_profile, threats = excluded.threats,
                set_pieces = excluded.set_pieces, match_goals = excluded.match_goals,
                checklist_json = excluded.checklist_json, updated_at = excluded.updated_at
            """,
            (
                payload["matchId"], payload.get("opponentProfile", ""), payload.get("threats", ""),
                payload.get("setPieces", ""), payload.get("matchGoals", ""),
                json.dumps(payload.get("checklist", []), ensure_ascii=False), now, now,
            ),
        )
        conn.commit()
    return get_match_plan(payload["matchId"])  # type: ignore[return-value]


def _match_event_from_row(row: sqlite3.Row) -> dict[str, Any]:
    event = _row_to_dict(row)
    event["matchId"] = event.pop("match_id")
    event["type"] = event.pop("event_type")
    return event


def list_match_events(match_id: str, limit: int = 80) -> list[dict[str, Any]]:
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM match_events WHERE match_id = ? ORDER BY created_at DESC LIMIT ?",
            (match_id, max(1, min(limit, 200))),
        ).fetchall()
    return [_match_event_from_row(row) for row in rows]


def create_match_event(match_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    created_at = datetime.now(timezone.utc).isoformat()
    with closing(sqlite3.connect(DB_PATH)) as conn:
        cursor = conn.execute(
            "INSERT INTO match_events (match_id, event_type, minute, note, created_at) VALUES (?, ?, ?, ?, ?)",
            (match_id, payload["type"], payload.get("minute"), payload.get("note", ""), created_at),
        )
        conn.commit()
        event_id = cursor.lastrowid
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM match_events WHERE id = ?", (event_id,)).fetchone()
    return _match_event_from_row(row)  # type: ignore[arg-type]


def delete_match_event(match_id: str, event_id: int) -> bool:
    with closing(sqlite3.connect(DB_PATH)) as conn:
        cursor = conn.execute("DELETE FROM match_events WHERE match_id = ? AND id = ?", (match_id, event_id))
        conn.commit()
    return cursor.rowcount > 0


def list_match_history(limit: int = 100) -> list[dict[str, Any]]:
    """Return manager dossiers assembled from reports and linked tactical boards."""
    capped_limit = max(1, min(limit, 200))
    reports = {report["matchId"]: report for report in list_match_reports(capped_limit)}
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT * FROM tactical_boards
            WHERE match_id IS NOT NULL AND match_id != ''
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (capped_limit * 4,),
        ).fetchall()

    dossiers: dict[str, dict[str, Any]] = {
        match_id: {
            **report,
            "boards": [],
            "sessions": [],
            "boardCount": 0,
            "sessionCount": 0,
            "entryCount": 0,
            "lastActivity": report.get("updated_at"),
        }
        for match_id, report in reports.items()
    }
    for row in rows:
        board = _tactical_board_from_row(row)
        match_id = board["matchId"]
        dossier = dossiers.setdefault(
            match_id,
            {
                "matchId": match_id,
                "opponent": "",
                "competition": "",
                "matchDate": None,
                "status": "pre-match",
                "scoreFor": None,
                "scoreAgainst": None,
                "lineup": [],
                "summary": "",
                "takeaways": "",
                "tags": [],
                "created_at": board["created_at"],
                "updated_at": board["updated_at"],
                "boards": [],
                "sessions": [],
                "boardCount": 0,
                "sessionCount": 0,
                "entryCount": 0,
                "lastActivity": board["updated_at"],
            },
        )
        dossier["boards"].append({
            "id": board["id"],
            "name": board["name"],
            "category": board["category"],
            "description": board["description"],
            "updatedAt": board["updated_at"],
            "sceneCount": len(board["document"].get("scenes", [])),
        })
        for session in board["document"].get("analysis", {}).get("sessions", []):
            if session.get("matchId") not in {None, match_id}:
                continue
            entries = session.get("entries", [])
            dossier["sessions"].append({
                "id": session.get("id", ""),
                "boardId": board["id"],
                "boardName": board["name"],
                "name": session.get("name", "Sesion"),
                "type": session.get("type", "pre-match"),
                "createdAt": session.get("createdAt"),
                "entryCount": len(entries),
            })
            dossier["entryCount"] += len(entries)
        dossier["boardCount"] = len(dossier["boards"])
        dossier["sessionCount"] = len(dossier["sessions"])
        if board["updated_at"] > (dossier.get("lastActivity") or ""):
            dossier["lastActivity"] = board["updated_at"]

    for match_id, dossier in dossiers.items():
        dossier["attachments"] = list_match_report_files(match_id)
        dossier["attachmentCount"] = len(dossier["attachments"])
        dossier["matchPlan"] = get_match_plan(match_id)
        dossier["events"] = list_match_events(match_id)
        dossier["eventCount"] = len(dossier["events"])

    return sorted(
        dossiers.values(),
        key=lambda dossier: dossier.get("matchDate") or dossier.get("lastActivity") or "",
        reverse=True,
    )[:capped_limit]


def upsert_match_report(payload: dict[str, Any]) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.execute(
            """
            INSERT INTO match_reports (match_id, opponent, competition, match_date, status, score_for, score_against, lineup_json, summary, takeaways, tags_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(match_id) DO UPDATE SET
                opponent = excluded.opponent, competition = excluded.competition, match_date = excluded.match_date,
                status = excluded.status, score_for = excluded.score_for, score_against = excluded.score_against,
                lineup_json = excluded.lineup_json, summary = excluded.summary, takeaways = excluded.takeaways,
                tags_json = excluded.tags_json, updated_at = excluded.updated_at
            """,
            (
                payload["matchId"], payload.get("opponent", ""), payload.get("competition", ""), payload.get("matchDate"),
                payload.get("status", "pre-match"), payload.get("scoreFor"), payload.get("scoreAgainst"),
                json.dumps(payload.get("lineup", []), ensure_ascii=False), payload.get("summary", ""), payload.get("takeaways", ""),
                json.dumps(payload.get("tags", []), ensure_ascii=False), now, now,
            ),
        )
        conn.commit()
    return get_match_report(payload["matchId"])  # type: ignore[return-value]


def list_tactical_players(team: str | None = None) -> list[dict[str, Any]]:
    query = "SELECT id, name, number, position, team, avatar_url, created_at, updated_at FROM tactical_players"
    params: tuple[Any, ...] = ()
    if team in {"home", "away"}:
        query += " WHERE team = ?"
        params = (team,)
    query += " ORDER BY team, number, name"
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(query, params).fetchall()
    players = []
    for row in rows:
        player = _row_to_dict(row)
        player["avatarUrl"] = player.pop("avatar_url")
        players.append(player)
    return players


def create_tactical_player(payload: dict[str, Any]) -> dict[str, Any]:
    player_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.execute(
            """
            INSERT INTO tactical_players (id, name, number, position, team, avatar_url, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                player_id,
                payload["name"],
                int(payload["number"]),
                payload.get("position", "LIBRE"),
                payload.get("team", "home"),
                payload.get("avatarUrl"),
                now,
                now,
            ),
        )
        conn.commit()
    return next(player for player in list_tactical_players() if player["id"] == player_id)


def delete_tactical_player(player_id: str) -> bool:
    with closing(sqlite3.connect(DB_PATH)) as conn:
        cursor = conn.execute("DELETE FROM tactical_players WHERE id = ?", (player_id,))
        conn.commit()
    return cursor.rowcount > 0


def _lineup_template_from_row(row: sqlite3.Row) -> dict[str, Any]:
    template = _row_to_dict(row)
    template["players"] = json.loads(template.pop("players_json"))
    return template


def list_tactical_lineup_templates() -> list[dict[str, Any]]:
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT * FROM tactical_lineup_templates ORDER BY updated_at DESC").fetchall()
    return [_lineup_template_from_row(row) for row in rows]


def create_tactical_lineup_template(payload: dict[str, Any]) -> dict[str, Any]:
    template_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.execute(
            """
            INSERT INTO tactical_lineup_templates (id, name, formation, players_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (template_id, payload["name"], payload.get("formation", ""), json.dumps(payload["players"], ensure_ascii=False), now, now),
        )
        conn.commit()
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM tactical_lineup_templates WHERE id = ?", (template_id,)).fetchone()
    return _lineup_template_from_row(row)  # type: ignore[arg-type]


def delete_tactical_lineup_template(template_id: str) -> bool:
    with closing(sqlite3.connect(DB_PATH)) as conn:
        cursor = conn.execute("DELETE FROM tactical_lineup_templates WHERE id = ?", (template_id,))
        conn.commit()
    return cursor.rowcount > 0
