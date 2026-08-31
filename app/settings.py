import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = BASE_DIR / "uploads"
CLIPS_DIR = Path(os.getenv("KORU_CLIPS_DIR", str(UPLOAD_DIR / "clipskoru")))
IMAGES_DIR = Path(os.getenv("KORU_IMAGES_DIR", str(UPLOAD_DIR / "imageneskoru")))
DB_PATH = Path(os.getenv("KORU_DB_PATH", str(DATA_DIR / "koru.db")))
MAX_UPLOAD_BYTES = max(1, int(os.getenv("KORU_MAX_UPLOAD_MB", "1024"))) * 1024 * 1024

DASHBOARD_CACHE_SECONDS = 300
HTTP_TIMEOUT_SECONDS = 12
AUTH_COOKIE_NAME = "koru_access"
AUTH_SESSION_HOURS = int(os.getenv("KORU_AUTH_SESSION_HOURS", "12"))
AUTH_PASSWORD = os.getenv("KORU_ACCESS_PASSWORD", "")
AUTH_SECRET = os.getenv("KORU_AUTH_SECRET", "")

KORU = {
    "name": "KORU eClub",
    "slug": "koru-eclub",
    "vpg_id": 36769,
    "plg_id": 29377,
}

VPG_API = "https://api.virtualprogaming.com/public"
VPG_ASSET_URL = "https://vpg-prod-user-uploads.fra1.cdn.digitaloceanspaces.com"

PLG_API = "https://www.virtualpronetwork.com/api"

SOURCES = {
    "x": "https://x.com/Koru_eClub",
    "plg_team": "https://www.virtualpronetwork.com/web/app/team/29377/koru-eclub",
    "plg_league": "https://www.virtualpronetwork.com/web/app/league/2217/regional-b-plg",
    "vpg_team": "https://virtualprogaming.com/team/koru-eclub",
    "vpg_zero": "https://virtualprogaming.com/league/zero-gold",
    "vpg_cuarta": "https://virtualprogaming.com/league/cuarta-division-a-spain",
}
