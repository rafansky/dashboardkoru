import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import UploadFile

from .settings import DATA_DIR, DB_PATH, UPLOAD_DIR


def init_storage() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
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
        conn.commit()


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {key: row[key] for key in row.keys()}


def list_notes(limit: int = 20) -> list[dict[str, Any]]:
    with sqlite3.connect(DB_PATH) as conn:
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
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            "INSERT INTO notes (body, author, created_at) VALUES (?, ?, ?)",
            (clean_body, clean_author, created_at),
        )
        conn.commit()
        note_id = cursor.lastrowid
    return {"id": note_id, "body": clean_body, "author": clean_author, "created_at": created_at}


def delete_note(note_id: int) -> bool:
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        conn.commit()
    return cursor.rowcount > 0


def list_files(limit: int = 30) -> list[dict[str, Any]]:
    with sqlite3.connect(DB_PATH) as conn:
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
    with sqlite3.connect(DB_PATH) as conn:
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
