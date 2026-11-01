"""Public VPG lineups, full pagination and verified cross-platform player IDs."""
import asyncio
import json
from collections import defaultdict
from contextlib import closing
from datetime import datetime
from urllib.parse import quote

from .settings import VPG_API, KORU
from .potw_scoring import week_of

ROLES = {"GK": "goalkeeper", **dict.fromkeys("CB LCB RCB LB RB LWB RWB".split(), "defender"),
         **dict.fromkeys("CDM LDM RDM CM LCM RCM CAM LM RM".split(), "midfielder"),
         **dict.fromkeys("ST LS RS CF LF RF LW RW".split(), "forward")}


async def match_pages(client, status):
    rows, seen, offset = [], set(), 0
    for _ in range(100):
        response = await client.get(f"{VPG_API}/teams/{KORU['slug']}/matches/",
                                    params={"match_status": status, "limit": 30, "offset": offset})
        response.raise_for_status()
        payload = response.json()
        page = payload.get("data", [])
        fresh = [m for m in page if m["id"] not in seen]
        if not fresh and offset < int(payload.get("count", offset)):
            raise ValueError("VPG no permite completar la paginación del calendario")
        rows.extend(fresh)
        seen.update(m["id"] for m in fresh)
        offset += len(page)
        if offset >= int(payload.get("count", offset)) or not page:
            return rows
    raise ValueError("Calendario VPG supera el límite de paginación")


async def sync_vpg(client):
    from . import potw
    warnings = []
    try:
        response = await client.get(f"{VPG_API}/teams/{KORU['slug']}/leagues/")
        response.raise_for_status()
        memberships = response.json()
        slugs = {row["slug"] for row in memberships}
        complete, scheduled = await asyncio.gather(match_pages(client, "complete"), match_pages(client, "scheduled"))
        rows = {m["id"]: m for m in scheduled + complete if m.get("league_slug") in slugs}
        seasons = {}
        for m in rows.values():
            seasons[m["league_slug"]] = max(seasons.get(m["league_slug"], 0), int(m.get("season") or 0))
        rows = {mid: m for mid, m in rows.items() if int(m.get("season") or 0) == seasons[m["league_slug"]]}
        with closing(potw.connection()) as conn, conn:
            for mid, match in rows.items():
                if KORU["vpg_id"] not in (match.get("home_id"), match.get("away_id")):
                    raise ValueError("VPG devuelve un encuentro de otro equipo")
                conn.execute("INSERT INTO potw_vpg_fixtures VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
                             (mid, week_of(match["datetime"]), json.dumps(match)))
        semaphore = asyncio.Semaphore(3)
        async def load(mid, match):
            if match.get("status") != "complete":
                return
            with closing(potw.connection()) as conn:
                cached = conn.execute("SELECT fetched_at FROM potw_vpg_reports WHERE id=?", (mid,)).fetchone()
            age = potw.now() - datetime.fromisoformat(match["datetime"].replace("Z", "+00:00"))
            if cached and age.days > 14 and (potw.now()-datetime.fromisoformat(cached[0])).total_seconds() < 86400:
                return
            async with semaphore:
                try:
                    response = await client.get(f"{VPG_API}/matches/{mid}/data/")
                    response.raise_for_status()
                    data = response.json()
                    if not isinstance(data, list) or any(p.get("match_id") != mid or p.get("team_id") not in (match["home_id"], match["away_id"]) for p in data):
                        raise ValueError("VPG devuelve un informe de otro partido")
                    with closing(potw.connection()) as conn, conn:
                        conn.execute("INSERT OR REPLACE INTO potw_vpg_reports VALUES (?, ?, ?)",
                                     (mid, json.dumps(data), potw.now().isoformat()))
                except Exception:
                    warnings.append(f"VPG {mid}: informe pendiente de actualización")
        await asyncio.gather(*(load(mid, m) for mid, m in rows.items()))
        # Only retain public identifiers used to link platform accounts. Do not
        # persist unrelated profile fields returned by the provider.
        with closing(potw.connection()) as conn:
            users = {str(p["user_id"]): p["username"] for row in conn.execute("SELECT payload FROM potw_vpg_reports")
                     for p in json.loads(row[0]) if p.get("team_id") == KORU["vpg_id"]}
            known = {row[0] for row in conn.execute("SELECT id FROM potw_vpg_users")}
        async def profile(pid, username):
            if pid in known:
                return
            async with semaphore:
                try:
                    response = await client.get(f"{VPG_API}/users/{quote(username, safe='')}/")
                    response.raise_for_status()
                    raw = response.json()
                    if str(raw.get("id")) != pid:
                        raise ValueError("Perfil de otro jugador")
                    public = {k: raw.get(k) for k in ("id", "username", "psn", "origin", "xbox")}
                    with closing(potw.connection()) as conn, conn:
                        conn.execute("INSERT OR REPLACE INTO potw_vpg_users VALUES (?, ?)", (pid, json.dumps(public)))
                except Exception:
                    warnings.append(f"VPG {username}: identidad pendiente de vincular")
        await asyncio.gather(*(profile(pid, name) for pid, name in users.items()))
        with closing(potw.connection()) as conn, conn:
            conn.execute("INSERT OR REPLACE INTO potw_meta VALUES ('vpg_synced_at', ?)", (potw.now().isoformat(),))
        return {"ok": True, "warnings": warnings}
    except Exception as exc:
        return {"ok": False, "warnings": [f"VPG: no se pudo consultar el calendario completo ({type(exc).__name__}); se conserva la caché"]}


def award_data():
    from . import potw
    fixtures, reports = potw.source_data()
    aliases, names = defaultdict(set), {}
    for report in reports.values():
        for side in ("home", "away"):
            if report[side]["teamId"] != KORU["plg_id"]:
                continue
            for p in report[side]["players"]:
                pid = str(p["userId"])
                names[pid] = p["name"]
                for alias in [p["name"], *(p.get("platformIds") or {}).values()]:
                    if alias:
                        aliases[str(alias).strip().casefold()].add(pid)
    with closing(potw.connection()) as conn:
        profiles = {r["id"]: json.loads(r["payload"]) for r in conn.execute("SELECT * FROM potw_vpg_users")}
        vpg_reports = {r["id"]: json.loads(r["payload"]) for r in conn.execute("SELECT * FROM potw_vpg_reports")}
        vpg_fixtures = list(conn.execute("SELECT * FROM potw_vpg_fixtures ORDER BY week, id"))
    for row in vpg_fixtures:
        m = json.loads(row["payload"])
        mid = f"vpg:{row['id']}"
        home = m["home_id"] == KORU["vpg_id"]
        fixture = dict(id=mid, sourceId=row["id"], platform="VPG", round=m.get("match_day"), date=m["datetime"],
                       published=m.get("status") == "complete", opponent=m["away_name"] if home else m["home_name"],
                       competition=m.get("league_name"), forfeit=bool(m.get("forfeit")),
                       url=f"https://virtualprogaming.com/match/{row['id']}")
        fixtures.append((row["week"], fixture))
        if row["id"] not in vpg_reports:
            continue
        sides = {key: dict(teamId=KORU["plg_id"] if m[f"{key}_id"] == KORU["vpg_id"] else f"vpg-team:{m[f'{key}_id']}", players=[]) for key in ("home", "away")}
        for p in vpg_reports[row["id"]]:
            key = "home" if p["team_id"] == m["home_id"] else "away"
            pid, name = f"vpg:{p['user_id']}", p["username"]
            if p["team_id"] == KORU["vpg_id"]:
                profile = profiles.get(str(p["user_id"]), {})
                candidates = set().union(*(aliases.get(str(a).strip().casefold(), set()) for a in
                                            [name, *(profile.get(k) for k in ("psn", "origin", "xbox"))] if a))
                if len(candidates) == 1:
                    pid = candidates.pop()
                    name = names[pid]
            code = p.get("position", "")
            sides[key]["players"].append(dict(userId=pid, name=name,
                position={"code": code, "group": ROLES.get(code)},
                ea={"rating": p.get("match_rating")},
                stats={"1": p.get("goals"), "2": p.get("assists"), "6": p.get("red_card")}))
        reports[mid] = dict(match={"id": mid, "published": fixture["published"], "forfeit": fixture["forfeit"],
                                  "score": {"home": m.get("home_score"), "away": m.get("away_score")}}, **sides)
    return fixtures, reports
