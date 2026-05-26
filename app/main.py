from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .services.dashboard import dashboard_service
from .settings import STATIC_DIR, UPLOAD_DIR
from .storage import add_note, delete_note, init_storage, list_files, list_notes, save_upload

app = FastAPI(title="KORU eClub Dashboard", version="0.1.0")


@app.on_event("startup")
def startup() -> None:
    init_storage()


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


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
