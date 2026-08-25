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
