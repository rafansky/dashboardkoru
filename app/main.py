import hashlib
import hmac
import os
import secrets
import time
from base64 import urlsafe_b64decode, urlsafe_b64encode

from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from .services.dashboard import dashboard_service
from .settings import (
    AUTH_COOKIE_NAME,
    AUTH_PASSWORD,
    AUTH_SECRET,
    AUTH_SESSION_HOURS,
    STATIC_DIR,
    UPLOAD_DIR,
)
from .storage import (
    add_note,
    create_tactical_player,
    create_tactical_board,
    delete_note,
    delete_tactical_board,
    delete_tactical_player,
    get_tactical_board,
    get_match_report,
    init_storage,
    list_files,
    list_notes,
    list_tactical_boards,
    list_tactical_players,
    list_match_reports,
    save_upload,
    upsert_match_report,
    update_tactical_board,
)
from .tactics_models import MatchReportUpsert, TacticalBoardCreate, TacticalBoardUpdate, TacticalSquadPlayerCreate

app = FastAPI(title="KORU eClub Dashboard", version="0.1.0")

_SECRET = AUTH_SECRET or os.getenv("KORU_AUTH_SECRET") or secrets.token_urlsafe(32)
_PASSWORD = AUTH_PASSWORD or os.getenv("KORU_ACCESS_PASSWORD")
_SESSION_SECONDS = max(1, AUTH_SESSION_HOURS) * 3600


def _token_signature(payload: str) -> str:
    digest = hmac.new(_SECRET.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).digest()
    return urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def _create_token() -> str:
    expires_at = str(int(time.time()) + _SESSION_SECONDS)
    payload = urlsafe_b64encode(expires_at.encode("utf-8")).decode("ascii").rstrip("=")
    signature = _token_signature(payload)
    return f"{payload}.{signature}"


def _is_authenticated(request: Request) -> bool:
    token = request.cookies.get(AUTH_COOKIE_NAME)
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


def _public_path(path: str) -> bool:
    if path in {"/login", "/api/login", "/api/health", "/favicon.ico"}:
        return True
    if path.startswith("/assets/"):
        return True
    if path.startswith("/static/login"):
        return True
    return False


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if _public_path(request.url.path) or _is_authenticated(request):
        return await call_next(request)

    if request.url.path.startswith("/api/"):
        return JSONResponse(status_code=401, content={"detail": "No autorizado"})
    return RedirectResponse(url="/login", status_code=303)


@app.on_event("startup")
def startup() -> None:
    if not _PASSWORD:
        raise RuntimeError("KORU_ACCESS_PASSWORD no esta configurado.")
    init_storage()


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/tactics")
async def tactics_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "tactics.html")


@app.get("/login")
async def login_page(request: Request):
    if _is_authenticated(request):
        return RedirectResponse(url="/", status_code=303)
    return FileResponse(STATIC_DIR / "login.html")


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/login")
async def login(password: str = Form(...)) -> JSONResponse:
    if not hmac.compare_digest(password, _PASSWORD):
        raise HTTPException(status_code=401, detail="Clave incorrecta")
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
    return await save_upload(file)


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
        return board
    if not get_tactical_board(board_id):
        raise HTTPException(status_code=404, detail="Pizarra no encontrada")
    raise HTTPException(status_code=409, detail="La pizarra fue modificada en otra sesion")


@app.delete("/api/tactical-boards/{board_id}")
async def remove_board(board_id: str) -> dict[str, bool]:
    if not delete_tactical_board(board_id):
        raise HTTPException(status_code=404, detail="Pizarra no encontrada")
    return {"deleted": True}


@app.get("/api/match-reports")
async def match_reports() -> list[dict]:
    return list_match_reports()


@app.get("/api/match-reports/{match_id}")
async def match_report(match_id: str) -> dict:
    report = get_match_report(match_id)
    if not report:
        raise HTTPException(status_code=404, detail="Informe de partido no encontrado")
    return report


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
