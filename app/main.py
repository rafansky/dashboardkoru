import hashlib
import hmac
import json
import os
import secrets
import time
from base64 import urlsafe_b64decode, urlsafe_b64encode
from copy import deepcopy
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from .services.dashboard import dashboard_service
from .settings import (
    AUTH_COOKIE_NAME,
    AUTH_PASSWORD,
    AUTH_SECRET,
    AUTH_SESSION_HOURS,
    CLIPS_DIR,
    HTTP_TIMEOUT_SECONDS,
    IMAGES_DIR,
    MAX_UPLOAD_BYTES,
    STATIC_DIR,
    UPLOAD_DIR,
    VPG_ASSET_URL,
)
from .storage import (
    add_note,
    attach_file_to_match_report,
    create_tactical_player,
    create_tactical_lineup_template,
    create_tactical_play_template,
    create_tactical_board,
    create_tactical_share_link,
    create_match_event,
    create_match_video_clip,
    create_match_video_note,
    delete_match_callup,
    delete_note,
    delete_match_event,
    delete_match_video_clip,
    delete_match_video_note,
    detach_file_from_match_report,
    delete_tactical_board,
    delete_tactical_player,
    delete_tactical_lineup_template,
    delete_tactical_play_template,
    get_tactical_board,
    get_tactical_board_by_share_token,
    get_tactical_play_template,
    get_match_report,
    get_match_plan,
    init_storage,
    list_files,
    list_match_history,
    list_match_report_files,
    list_match_events,
    list_match_callups,
    list_notes,
    list_tactical_boards,
    list_tactical_players,
    list_tactical_lineup_templates,
    list_tactical_play_templates,
    list_match_reports,
    list_match_video_clips,
    list_opponent_profiles,
    save_upload,
    upsert_match_report,
    upsert_match_callup,
    upsert_match_plan,
    upsert_opponent_profile,
    update_tactical_board,
)
from .tactics_models import MatchCallupUpsert, MatchEventCreate, MatchPlanUpsert, MatchReportFileLink, MatchReportUpsert, MatchVideoClipCreate, MatchVideoNoteCreate, OpponentProfileUpsert, TacticalBoardCreate, TacticalBoardUpdate, TacticalLineupTemplateCreate, TacticalPlayTemplateCreate, TacticalSquadPlayerCreate

app = FastAPI(title="KORU eClub Dashboard", version="0.1.0")

_SECRET = AUTH_SECRET or os.getenv("KORU_AUTH_SECRET") or secrets.token_urlsafe(32)
_PASSWORD = AUTH_PASSWORD or os.getenv("KORU_ACCESS_PASSWORD")
_SESSION_SECONDS = max(1, AUTH_SESSION_HOURS) * 3600
_viewer_connections: dict[str, set[WebSocket]] = {}
_login_attempts: dict[str, list[float]] = {}
_LOGIN_WINDOW_SECONDS = 5 * 60
_LOGIN_MAX_ATTEMPTS = 8
_MAX_LIVE_MESSAGE_BYTES = 512 * 1024


def _public_tactical_board(board: dict) -> dict:
    """Return only the board fields required by the read-only share viewer."""
    document = deepcopy(board.get("document") or {})
    document.pop("analysis", None)
    metadata = document.get("metadata") or {}
    document["metadata"] = {
        key: metadata[key]
        for key in ("activeSceneIndex", "formation")
        if key in metadata
    }
    return {
        key: deepcopy(board[key])
        for key in ("id", "name", "category", "description", "version", "updated_at", "document")
        if key in board
    } | {"document": document}


async def _broadcast_tactical_message(board_id: str, message: dict) -> None:
    connections = _viewer_connections.get(board_id)
    if not connections:
        return
    disconnected: list[WebSocket] = []
    for websocket in tuple(connections):
        try:
            await websocket.send_json(message)
        except Exception:
            disconnected.append(websocket)
    for websocket in disconnected:
        connections.discard(websocket)
    if not connections:
        _viewer_connections.pop(board_id, None)


async def _broadcast_tactical_board(board: dict) -> None:
    """Send the latest saved board to every read-only viewer of that board."""
    board_id = str(board.get("id", ""))
    await _broadcast_tactical_message(board_id, {"type": "board", "board": _public_tactical_board(board)})


def _token_signature(payload: str) -> str:
    digest = hmac.new(_SECRET.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).digest()
    return urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def _create_token() -> str:
    expires_at = str(int(time.time()) + _SESSION_SECONDS)
    payload = urlsafe_b64encode(expires_at.encode("utf-8")).decode("ascii").rstrip("=")
    signature = _token_signature(payload)
    return f"{payload}.{signature}"


def _is_valid_auth_token(token: str | None) -> bool:
    if not token or "." not in token:
        return False
    payload, signature = token.split(".", 1)
    expected = _token_signature(payload)
    if not hmac.compare_digest(signature, expected):
        return False
    try:
        padded = payload + "=" * (-len(payload) % 4)
        expires_raw = urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
        expires_at = int(expires_raw)
    except Exception:
        return False
    return expires_at > int(time.time())


def _is_authenticated(request: Request) -> bool:
    return _is_valid_auth_token(request.cookies.get(AUTH_COOKIE_NAME))


def _login_client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _login_is_limited(client_key: str) -> bool:
    cutoff = time.monotonic() - _LOGIN_WINDOW_SECONDS
    attempts = [item for item in _login_attempts.get(client_key, []) if item >= cutoff]
    if attempts:
        _login_attempts[client_key] = attempts
    else:
        _login_attempts.pop(client_key, None)
    return len(attempts) >= _LOGIN_MAX_ATTEMPTS


def _record_login_failure(client_key: str) -> None:
    _login_attempts.setdefault(client_key, []).append(time.monotonic())


def _public_path(path: str) -> bool:
    if path in {"/login", "/api/login", "/api/health", "/api/tactical-avatar", "/favicon.ico"}:
        return True
    if path.startswith("/assets/"):
        return True
    if path.startswith("/imageneskoru/"):
        return True
    if path.startswith("/static/login"):
        return True
    if path.startswith("/static/viewer"):
        return True
    if path.startswith("/static/tactics/"):
        return True
    if path.startswith("/watch/") or path.startswith("/api/public/tactics/") or path.startswith("/ws/tactical/"):
        return True
    return False


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if _public_path(request.url.path) or _is_authenticated(request):
        response = await call_next(request)
    elif request.url.path.startswith("/api/"):
        response = JSONResponse(status_code=401, content={"detail": "No autorizado"})
    else:
        response = RedirectResponse(url="/login", status_code=303)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    return response


@app.on_event("startup")
def startup() -> None:
    if not _PASSWORD:
        raise RuntimeError("KORU_ACCESS_PASSWORD no esta configurado.")
    init_storage()


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
app.mount("/clipskoru", StaticFiles(directory=CLIPS_DIR, check_dir=False), name="clipskoru")
app.mount("/imageneskoru", StaticFiles(directory=IMAGES_DIR, check_dir=False), name="imageneskoru")


@app.get("/api/tactical-avatar")
async def tactical_avatar(source: str = Query(..., min_length=12, max_length=900)) -> Response:
    """Serve VPG avatars same-origin so they can safely become WebGL textures."""
    remote = urlparse(source)
    allowed_host = urlparse(VPG_ASSET_URL).hostname
    if (
        remote.scheme != "https"
        or remote.hostname != allowed_host
        or remote.username
        or remote.password
    ):
        raise HTTPException(status_code=400, detail="Origen de avatar no permitido")
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS, follow_redirects=False) as client:
            response = await client.get(source, headers={"User-Agent": "KoruDashboard/1.0"})
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail="No se pudo obtener el avatar") from error
    if response.status_code != 200:
        raise HTTPException(status_code=404, detail="Avatar no disponible")
    if len(response.content) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="El avatar supera el limite permitido")
    media_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
    detected_type = _detect_image_type(response.content)
    if media_type in {"application/octet-stream", "binary/octet-stream", ""}:
        media_type = detected_type or ""
    if media_type == "image/jpg":
        media_type = "image/jpeg"
    if media_type not in {"image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"} or detected_type != media_type:
        raise HTTPException(status_code=415, detail="El recurso no es una imagen")
    return Response(
        content=response.content,
        media_type=media_type,
        headers={"Cache-Control": "private, max-age=86400"},
    )


def _detect_image_type(content: bytes) -> str | None:
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if content.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    if len(content) >= 12 and content[4:8] == b"ftyp" and content[8:12] in {b"avif", b"avis"}:
        return "image/avif"
    return None


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/tactics")
async def tactics_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "tactics.html")


@app.get("/watch/{token}")
async def tactics_viewer_page(token: str) -> FileResponse:
    if not get_tactical_board_by_share_token(token):
        raise HTTPException(status_code=404, detail="Enlace de visualizacion no valido")
    return FileResponse(STATIC_DIR / "tactics-viewer.html")


@app.get("/match-history")
async def match_history_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "match-history.html")


@app.get("/login")
async def login_page(request: Request):
    if _is_authenticated(request):
        return RedirectResponse(url="/", status_code=303)
    return FileResponse(STATIC_DIR / "login.html")


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/public/tactics/{token}")
async def public_tactical_board(token: str) -> dict:
    board = get_tactical_board_by_share_token(token)
    if not board:
        raise HTTPException(status_code=404, detail="Enlace de visualizacion no valido")
    return _public_tactical_board(board)


@app.websocket("/ws/tactical/{token}")
async def tactical_viewer_socket(websocket: WebSocket, token: str) -> None:
    board = get_tactical_board_by_share_token(token)
    if not board:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    board_id = str(board["id"])
    connections = _viewer_connections.setdefault(board_id, set())
    connections.add(websocket)
    try:
        await websocket.send_json({"type": "board", "board": _public_tactical_board(board)})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        connections.discard(websocket)
        if not connections:
            _viewer_connections.pop(board_id, None)


@app.websocket("/ws/tactical-control/{board_id}")
async def tactical_presenter_socket(websocket: WebSocket, board_id: str) -> None:
    """Accept validated, non-persistent presentation frames from an authenticated manager."""
    if not _is_valid_auth_token(websocket.cookies.get(AUTH_COOKIE_NAME)):
        await websocket.accept()
        await websocket.close(code=1008)
        return
    origin = websocket.headers.get("origin")
    if origin and urlparse(origin).netloc != websocket.headers.get("host"):
        await websocket.accept()
        await websocket.close(code=1008)
        return
    stored = get_tactical_board(board_id)
    if not stored:
        await websocket.accept()
        await websocket.close(code=1008)
        return
    await websocket.accept()
    try:
        while True:
            raw = await websocket.receive_text()
            if len(raw.encode("utf-8")) > _MAX_LIVE_MESSAGE_BYTES:
                await websocket.close(code=1009)
                return
            try:
                message = json.loads(raw)
                board_payload = dict(message.get("board") or {})
                board_payload.pop("version", None)
                validated = TacticalBoardCreate.model_validate(board_payload)
                presentation = message.get("presentation") or {}
                view_mode = presentation.get("viewMode", "2d")
                if view_mode not in {"2d", "3d"}:
                    raise ValueError("Vista no valida")
                layers = {
                    key: bool((presentation.get("layers") or {}).get(key, True))
                    for key in ("home", "away", "ball", "names", "annotations", "markings")
                }
                preview = {
                    **stored,
                    **validated.model_dump(mode="json", by_alias=True),
                    "id": board_id,
                }
                scene_count = len(preview["document"].get("scenes", []))
                scene_index = max(0, min(int(presentation.get("sceneIndex", 0)), max(0, scene_count - 1)))
            except (TypeError, ValueError, json.JSONDecodeError, ValidationError):
                await websocket.send_json({"type": "error", "detail": "Estado de presentacion no valido"})
                continue
            await _broadcast_tactical_message(board_id, {
                "type": "preview",
                "board": _public_tactical_board(preview),
                "presentation": {
                    "viewMode": view_mode,
                    "sceneIndex": scene_index,
                    "layers": layers,
                    "playing": bool(presentation.get("playing", False)),
                },
            })
    except WebSocketDisconnect:
        pass


@app.post("/api/login")
async def login(request: Request, password: str = Form(...)) -> JSONResponse:
    client_key = _login_client_key(request)
    if _login_is_limited(client_key):
        raise HTTPException(status_code=429, detail="Demasiados intentos. Espera unos minutos.")
    if not hmac.compare_digest(password, _PASSWORD):
        _record_login_failure(client_key)
        raise HTTPException(status_code=401, detail="Clave incorrecta")
    _login_attempts.pop(client_key, None)
    response = JSONResponse(content={"ok": True})
    secure = os.getenv("KORU_COOKIE_SECURE", "false").lower() == "true"
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=_create_token(),
        httponly=True,
        secure=secure,
        samesite="strict",
        max_age=_SESSION_SECONDS,
        path="/",
    )
    return response


@app.post("/api/logout")
async def logout() -> JSONResponse:
    response = JSONResponse(content={"ok": True})
    response.delete_cookie(key=AUTH_COOKIE_NAME, path="/")
    return response


@app.get("/api/dashboard")
async def dashboard(force: bool = False) -> dict:
    return await dashboard_service.get_dashboard(force=force)


@app.get("/api/notes")
async def notes() -> list[dict]:
    return list_notes()


@app.post("/api/notes")
async def create_note(body: str = Form(...), author: str = Form("KORU")) -> dict:
    if not body.strip():
        raise HTTPException(status_code=400, detail="La nota no puede estar vacia.")
    return add_note(body=body, author=author)


@app.delete("/api/notes/{note_id}")
async def remove_note(note_id: int) -> dict[str, bool]:
    return {"deleted": delete_note(note_id)}


@app.get("/api/files")
async def files() -> list[dict]:
    return list_files()


@app.post("/api/files")
async def upload_file(file: UploadFile = File(...)) -> dict:
    try:
        return await save_upload(file, max_bytes=MAX_UPLOAD_BYTES)
    except ValueError as error:
        status = 413 if "limite" in str(error).lower() else 400
        raise HTTPException(status_code=status, detail=str(error)) from error


@app.get("/api/tactical-boards")
async def tactical_boards(search: str = Query(default="", max_length=120)) -> list[dict]:
    return list_tactical_boards(search=search)


@app.post("/api/tactical-boards", status_code=201)
async def create_board(payload: TacticalBoardCreate) -> dict:
    return create_tactical_board(payload.model_dump(mode="json", by_alias=True))


@app.get("/api/tactical-boards/{board_id}")
async def tactical_board(board_id: str) -> dict:
    board = get_tactical_board(board_id)
    if not board:
        raise HTTPException(status_code=404, detail="Pizarra no encontrada")
    return board


@app.put("/api/tactical-boards/{board_id}")
async def save_board(board_id: str, payload: TacticalBoardUpdate) -> dict:
    board = update_tactical_board(board_id, payload.model_dump(mode="json", by_alias=True))
    if board:
        await _broadcast_tactical_board(board)
        return board
    if not get_tactical_board(board_id):
        raise HTTPException(status_code=404, detail="Pizarra no encontrada")
    raise HTTPException(status_code=409, detail="La pizarra fue modificada en otra sesion")


@app.delete("/api/tactical-boards/{board_id}")
async def remove_board(board_id: str) -> dict[str, bool]:
    if not delete_tactical_board(board_id):
        raise HTTPException(status_code=404, detail="Pizarra no encontrada")
    return {"deleted": True}


@app.post("/api/tactical-boards/{board_id}/share")
async def share_tactical_board(board_id: str) -> dict[str, str]:
    token = secrets.token_urlsafe(32)
    if not create_tactical_share_link(board_id, token):
        raise HTTPException(status_code=404, detail="Pizarra no encontrada")
    return {"token": token, "url": f"/watch/{token}"}


@app.get("/api/match-reports")
async def match_reports() -> list[dict]:
    return list_match_reports()


@app.get("/api/match-history")
async def match_history() -> list[dict]:
    return list_match_history()


@app.get("/api/opponent-profiles")
async def opponent_profiles() -> list[dict]:
    return list_opponent_profiles()


@app.put("/api/opponent-profiles")
async def save_opponent_profile(payload: OpponentProfileUpsert) -> dict:
    return upsert_opponent_profile(payload.model_dump(mode="json", by_alias=True))


@app.get("/api/match-reports/{match_id}")
async def match_report(match_id: str) -> dict:
    report = get_match_report(match_id)
    if not report:
        raise HTTPException(status_code=404, detail="Informe de partido no encontrado")
    return report


@app.get("/api/match-reports/{match_id}/files")
async def match_report_files(match_id: str) -> list[dict]:
    return list_match_report_files(match_id)


@app.get("/api/match-reports/{match_id}/plan")
async def match_plan(match_id: str) -> dict:
    plan = get_match_plan(match_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan de partido no encontrado")
    return plan


@app.put("/api/match-reports/{match_id}/plan")
async def save_match_plan(match_id: str, payload: MatchPlanUpsert) -> dict:
    if payload.match_id != match_id:
        raise HTTPException(status_code=400, detail="El identificador del plan no coincide")
    return upsert_match_plan(payload.model_dump(mode="json", by_alias=True))


@app.get("/api/match-reports/{match_id}/events")
async def match_events(match_id: str) -> list[dict]:
    return list_match_events(match_id)


@app.post("/api/match-reports/{match_id}/events", status_code=201)
async def add_match_event(match_id: str, payload: MatchEventCreate) -> dict:
    return create_match_event(match_id, payload.model_dump(mode="json"))


@app.delete("/api/match-reports/{match_id}/events/{event_id}")
async def remove_match_event(match_id: str, event_id: int) -> dict[str, bool]:
    if not delete_match_event(match_id, event_id):
        raise HTTPException(status_code=404, detail="Evento no encontrado")
    return {"deleted": True}


@app.get("/api/match-reports/{match_id}/clips")
async def match_video_clips(match_id: str) -> list[dict]:
    return list_match_video_clips(match_id)


@app.post("/api/match-reports/{match_id}/clips", status_code=201)
async def add_match_video_clip(match_id: str, payload: MatchVideoClipCreate) -> dict:
    return create_match_video_clip(match_id, payload.model_dump(mode="json", by_alias=True))


@app.delete("/api/match-reports/{match_id}/clips/{clip_id}")
async def remove_match_video_clip(match_id: str, clip_id: int) -> dict[str, bool]:
    if not delete_match_video_clip(match_id, clip_id):
        raise HTTPException(status_code=404, detail="Video no encontrado")
    return {"deleted": True}


@app.post("/api/match-reports/{match_id}/clips/{clip_id}/notes", status_code=201)
async def add_match_video_note(match_id: str, clip_id: int, payload: MatchVideoNoteCreate) -> dict:
    note = create_match_video_note(match_id, clip_id, payload.model_dump(mode="json", by_alias=True))
    if not note:
        raise HTTPException(status_code=404, detail="Video no encontrado")
    return note


@app.delete("/api/match-reports/{match_id}/clips/{clip_id}/notes/{note_id}")
async def remove_match_video_note(match_id: str, clip_id: int, note_id: int) -> dict[str, bool]:
    if not delete_match_video_note(match_id, clip_id, note_id):
        raise HTTPException(status_code=404, detail="Nota de video no encontrada")
    return {"deleted": True}


@app.get("/api/match-reports/{match_id}/callups")
async def match_callups(match_id: str) -> list[dict]:
    return list_match_callups(match_id)


@app.put("/api/match-reports/{match_id}/callups")
async def save_match_callup(match_id: str, payload: MatchCallupUpsert) -> dict:
    return upsert_match_callup(match_id, payload.model_dump(mode="json", by_alias=True))


@app.delete("/api/match-reports/{match_id}/callups/{roster_key}")
async def remove_match_callup(match_id: str, roster_key: str) -> dict[str, bool]:
    if not delete_match_callup(match_id, roster_key):
        raise HTTPException(status_code=404, detail="Convocado no encontrado")
    return {"deleted": True}


@app.post("/api/match-reports/{match_id}/files", status_code=201)
async def attach_match_report_file(match_id: str, payload: MatchReportFileLink) -> dict:
    attachment = attach_file_to_match_report(match_id, payload.file_id)
    if not attachment:
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    return attachment


@app.delete("/api/match-reports/{match_id}/files/{file_id}")
async def remove_match_report_file(match_id: str, file_id: int) -> dict[str, bool]:
    if not detach_file_from_match_report(match_id, file_id):
        raise HTTPException(status_code=404, detail="Adjunto no encontrado")
    return {"deleted": True}


@app.put("/api/match-reports/{match_id}")
async def save_match_report(match_id: str, payload: MatchReportUpsert) -> dict:
    if payload.match_id != match_id:
        raise HTTPException(status_code=400, detail="El identificador del informe no coincide")
    return upsert_match_report(payload.model_dump(mode="json", by_alias=True))


@app.get("/api/tactical-players")
async def tactical_players(team: str | None = Query(default=None, pattern="^(home|away)$")) -> list[dict]:
    return list_tactical_players(team=team)


@app.post("/api/tactical-players", status_code=201)
async def create_squad_player(payload: TacticalSquadPlayerCreate) -> dict:
    return create_tactical_player(payload.model_dump(mode="json", by_alias=True))


@app.delete("/api/tactical-players/{player_id}")
async def remove_squad_player(player_id: str) -> dict[str, bool]:
    if not delete_tactical_player(player_id):
        raise HTTPException(status_code=404, detail="Jugador no encontrado")
    return {"deleted": True}


@app.get("/api/tactical-lineup-templates")
async def tactical_lineup_templates() -> list[dict]:
    return list_tactical_lineup_templates()


@app.post("/api/tactical-lineup-templates", status_code=201)
async def create_lineup_template(payload: TacticalLineupTemplateCreate) -> dict:
    return create_tactical_lineup_template(payload.model_dump(mode="json", by_alias=True))


@app.delete("/api/tactical-lineup-templates/{template_id}")
async def remove_lineup_template(template_id: str) -> dict[str, bool]:
    if not delete_tactical_lineup_template(template_id):
        raise HTTPException(status_code=404, detail="Alineacion no encontrada")
    return {"deleted": True}


@app.get("/api/tactical-play-templates")
async def tactical_play_templates() -> list[dict]:
    return list_tactical_play_templates()


@app.get("/api/tactical-play-templates/{template_id}")
async def tactical_play_template(template_id: str) -> dict:
    template = get_tactical_play_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Jugada no encontrada")
    return template


@app.post("/api/tactical-play-templates", status_code=201)
async def create_play_template(payload: TacticalPlayTemplateCreate) -> dict:
    return create_tactical_play_template(payload.model_dump(mode="json", by_alias=True))


@app.delete("/api/tactical-play-templates/{template_id}")
async def remove_play_template(template_id: str) -> dict[str, bool]:
    if not delete_tactical_play_template(template_id):
        raise HTTPException(status_code=404, detail="Jugada no encontrada")
    return {"deleted": True}
