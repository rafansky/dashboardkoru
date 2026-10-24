"""Public VPN football profiles, fetched on demand behind dashboard authentication."""
import asyncio
import re
import time
from collections import OrderedDict

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from .potw import parse_page
from .settings import STATIC_DIR

router = APIRouter()
BASE = "https://virtualpronetwork.com"
_cache = OrderedDict()
_limit = asyncio.Semaphore(4)


def normalize_profile(general_page, history_page):
    profile = general_page.get("profileData") or {}
    user = profile.get("user") or {}
    if not user.get("id"):
        raise ValueError("Missing player identity")
    if str(history_page.get("userId")) != str(user["id"]):
        raise ValueError("Mismatched player history")
    general = general_page.get("general") or {}
    career = (history_page.get("history") or {}).get("career") or {}
    current, seen = [], set()
    for membership in general_page.get("userTeams") or []:
        team = membership.get("team") or {}
        if membership.get("game_id") == 1 and membership.get("active") and team.get("id") not in seen:
            current.append({"id": team.get("id"), "name": team.get("name")})
            seen.add(team.get("id"))
    return {
        "id": user["id"], "name": user.get("username"),
        "platformIds": {k: user[k] for k in ("psnid", "gamertag", "origin", "steam_id") if user.get(k)},
        "position": user.get("position"), "country": (user.get("user_country") or {}).get("nombre"),
        "currentTeams": current, "matches": general.get("matches"), "titles": general.get("titles"),
        "stats": [{"key": e["lang"], "value": e.get("total"), "averaged": bool(e.get("isAveraged"))}
                  for e in general.get("events", []) if e.get("lang")],
        "history": [{"team": (r.get("team") or {}).get("name"),
                     "competition": (r.get("league") or {}).get("name"),
                     "season": (r.get("season") or {}).get("number"),
                     "matches": r.get("games"), "events": r.get("events") or {},
                     "champion": bool(r.get("champion"))}
                    for r in career.get("rows", []) if (r.get("league") or {}).get("gameId") == 1],
        "historyPage": career.get("page", 1), "historyTotal": career.get("count", 0),
        "historyPageSize": career.get("perPage", 20),
        "sourceUrl": f"{BASE}/es/users/{user['id']}/general",
        "historyAvailable": bool(career),
    }


async def lookup_player(identifier, page=1):
    identifier = identifier.strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,79}", identifier):
        raise HTTPException(400, "Introduce una ID numérica de VPN o el nombre de su perfil.")
    key = (identifier, page)
    cached = _cache.get(key)
    if cached and time.monotonic() - cached[0] < 600:
        _cache.move_to_end(key)
        return cached[1]
    try:
        async with _limit, httpx.AsyncClient(timeout=20, follow_redirects=True,
                headers={"User-Agent": "KoruDashboard/1.0"}) as client:
            async def fetch(path):
                response = await client.get(BASE + path)
                if response.status_code == 404:
                    raise HTTPException(404, "No se encuentra ese jugador en VPN. Comprueba su ID o nombre de perfil.")
                response.raise_for_status()
                if len(response.content) > 12 * 1024 * 1024:
                    raise ValueError("Oversized profile")
                return parse_page(response.text)
            # Numeric IDs resolve via /general; bare numeric profile URLs return 404.
            base = f"/es/users/{identifier}"
            general, history = await asyncio.gather(fetch(base + ("/general" if identifier.isdigit() else "")), fetch(base + f"/history?page={page}"))
            if identifier.isdigit() and str(int(identifier)) != str(general.get("userId")):
                raise ValueError("Mismatched player ID")
            result = normalize_profile(general, history)
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        raise HTTPException(502, "VPN no puede devolver la ficha ahora. Inténtalo de nuevo en unos minutos.")
    _cache[key] = (time.monotonic(), result)
    while len(_cache) > 128:
        _cache.popitem(last=False)
    return result


@router.get("/players")
def player_search_page():
    return FileResponse(STATIC_DIR / "players.html")


@router.get("/api/players/lookup")
async def player_search(identifier: str = Query(min_length=1, max_length=80), page: int = Query(default=1, ge=1, le=500)):
    return await lookup_player(identifier, page)
