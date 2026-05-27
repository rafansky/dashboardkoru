import asyncio
import logging
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from app.settings import (
    DASHBOARD_CACHE_SECONDS,
    HTTP_TIMEOUT_SECONDS,
    KORU,
    PLG_API,
    SOURCES,
    VPG_API,
    VPG_ASSET_URL,
)

logger = logging.getLogger(__name__)
MADRID = ZoneInfo("Europe/Madrid")

VPG_LEAGUES = [
    {
        "key": "vpg-zero",
        "name": "ZERO GOLD",
        "slug": "zero-gold",
        "platform": "VPG Zero",
        "url": SOURCES["vpg_zero"],
        "accent": "#12d6df",
    },
    {
        "key": "vpg-cuarta",
        "name": "CUARTA DIVISION A",
        "slug": "cuarta-division-a-spain",
        "platform": "VPG",
        "url": SOURCES["vpg_cuarta"],
        "accent": "#f97316",
    },
]

PLG_LEAGUE = {
    "key": "plg-regional-b",
    "name": "REGIONAL B - PLG",
    "id": 2217,
    "platform": "PLG",
    "url": SOURCES["plg_league"],
    "accent": "#facc15",
}


class DashboardService:
    def __init__(self) -> None:
        self._cache: dict[str, Any] | None = None
        self._cached_at: datetime | None = None

    async def get_dashboard(self, force: bool = False) -> dict[str, Any]:
        now = datetime.now(timezone.utc)
        if (
            not force
            and self._cache
            and self._cached_at
            and (now - self._cached_at).total_seconds() < DASHBOARD_CACHE_SECONDS
        ):
            return self._cache

        async with httpx.AsyncClient(
            timeout=HTTP_TIMEOUT_SECONDS,
            headers={"User-Agent": "KoruDashboard/0.1"},
            follow_redirects=True,
        ) as client:
            vpg_task = self._fetch_vpg(client)
            plg_task = self._fetch_plg(client)
            vpg, plg = await asyncio.gather(vpg_task, plg_task)

        dashboard = self._build_dashboard(vpg, plg)
        if dashboard["competitions"]:
            self._cache = dashboard
            self._cached_at = now
        elif self._cache:
            stale = dict(self._cache)
            stale["stale"] = True
            stale["warnings"] = ["No se han podido refrescar las fuentes externas; se muestra la ultima cache."]
            return stale
        return dashboard

    async def _fetch_json(
        self, client: httpx.AsyncClient, url: str, params: dict[str, Any] | None = None
    ) -> Any:
        try:
            response = await client.get(url, params=params)
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            logger.warning("External fetch failed for %s: %s", url, exc)
            return None

    async def _fetch_vpg(self, client: httpx.AsyncClient) -> dict[str, Any]:
        team_slug = KORU["slug"]
        tasks: dict[str, Any] = {
            "team": self._fetch_json(client, f"{VPG_API}/teams/{team_slug}/"),
            "record": self._fetch_json(client, f"{VPG_API}/teams/{team_slug}/record/"),
            "leagues": self._fetch_json(client, f"{VPG_API}/teams/{team_slug}/leagues/"),
            "scheduled": self._fetch_json(
                client,
                f"{VPG_API}/teams/{team_slug}/matches/",
                {"match_status": "scheduled", "limit": 40, "offset": 0},
            ),
            "complete": self._fetch_json(
                client,
                f"{VPG_API}/teams/{team_slug}/matches/",
                {"match_status": "complete", "limit": 30, "offset": 0},
            ),
            "scorers": self._fetch_json(
                client,
                f"{VPG_API}/teams/{team_slug}/leaderboard/",
                {"leaderboard": "top_scorer", "weekly": "false", "limit": 10, "offset": 0},
            ),
            "assists": self._fetch_json(
                client,
                f"{VPG_API}/teams/{team_slug}/leaderboard/",
                {"leaderboard": "top_assist", "weekly": "false", "limit": 10, "offset": 0},
            ),
            "ratings": self._fetch_json(
                client,
                f"{VPG_API}/teams/{team_slug}/leaderboard/",
                {"leaderboard": "highest_rated", "weekly": "false", "limit": 10, "offset": 0},
            ),
        }
        for league in VPG_LEAGUES:
            tasks[f"table:{league['slug']}"] = self._fetch_json(
                client, f"{VPG_API}/leagues/{league['slug']}/table/"
            )
            tasks[f"league:{league['slug']}"] = self._fetch_json(
                client, f"{VPG_API}/leagues/{league['slug']}/"
            )

        keys = list(tasks.keys())
        values = await asyncio.gather(*tasks.values())
        return dict(zip(keys, values))

    async def _fetch_plg(self, client: httpx.AsyncClient) -> dict[str, Any]:
        team_id = KORU["plg_id"]
        league_id = PLG_LEAGUE["id"]
        team_task = self._fetch_json(client, f"{PLG_API}/teams/{team_id}")
        league = await self._fetch_json(client, f"{PLG_API}/leagues/{league_id}")
        active_season = self._active_plg_season_id(league)

        table_task = self._fetch_json(
            client,
            f"{PLG_API}/leagues/{league_id}/table",
            {"season": active_season} if active_season else None,
        )
        fixtures_task = self._fetch_json(client, f"{PLG_API}/teams/{team_id}/fixtures")
        results_task = self._fetch_json(client, f"{PLG_API}/teams/{team_id}/results")
        team, table, fixtures, results = await asyncio.gather(
            team_task, table_task, fixtures_task, results_task
        )

        return {
            "team": team,
            "league": league,
            "active_season": active_season,
            "table": table,
            "fixtures": fixtures,
            "results": results,
        }

    def _build_dashboard(self, vpg: dict[str, Any], plg: dict[str, Any]) -> dict[str, Any]:
        competitions = []

        vpg_matches_scheduled = _page_rows(vpg.get("scheduled"))
        vpg_matches_complete = _page_rows(vpg.get("complete"))
        for league in VPG_LEAGUES:
            table = _normalize_vpg_table(vpg.get(f"table:{league['slug']}") or [])
            upcoming = [
                _normalize_vpg_match(match)
                for match in vpg_matches_scheduled
                if match.get("league_slug") == league["slug"]
            ]
            recent = [
                _normalize_vpg_match(match)
                for match in vpg_matches_complete
                if match.get("league_slug") == league["slug"]
            ]
            competitions.append(
                _competition_payload(
                    config=league,
                    standings=table,
                    upcoming=sorted(upcoming, key=lambda item: item["datetime"])[:8],
                    recent=sorted(recent, key=lambda item: item["datetime"], reverse=True)[:8],
                    league_meta=vpg.get(f"league:{league['slug']}") or {},
                )
            )

        plg_table = _normalize_plg_table(plg.get("table") or [])
        plg_upcoming = [
            _normalize_plg_match(match, status="scheduled")
            for match in _page_rows(plg.get("fixtures"))
        ]
        plg_recent = [
            _normalize_plg_match(match, status="complete")
            for match in _page_rows(plg.get("results"))
            if _parse_plg_datetime(match.get("date")) <= datetime.now(timezone.utc)
        ]
        competitions.append(
            _competition_payload(
                config=PLG_LEAGUE,
                standings=plg_table,
                upcoming=sorted(plg_upcoming, key=lambda item: item["datetime"])[:8],
                recent=sorted(plg_recent, key=lambda item: item["datetime"], reverse=True)[:8],
                league_meta=plg.get("league") or {},
            )
        )

        competitions = [item for item in competitions if item["standings"] or item["upcoming"] or item["recent"]]
        team = _team_payload(vpg, plg)
        recent_all = sorted(
            [match for comp in competitions for match in comp["recent"]],
            key=lambda item: item["datetime"],
            reverse=True,
        )[:12]
        upcoming_all = sorted(
            [match for comp in competitions for match in comp["upcoming"]],
            key=lambda item: item["datetime"],
        )[:12]

        leaders = _leaderboards(vpg)
        dashboard = {
            "updatedAt": datetime.now(timezone.utc).isoformat(),
            "team": team,
            "summary": _summary(competitions, vpg.get("record") or {}),
            "competitions": competitions,
            "nextMatch": upcoming_all[0] if upcoming_all else None,
            "recent": recent_all,
            "upcoming": upcoming_all,
            "leaderboards": leaders,
            "analytics": _analytics(competitions, recent_all, leaders),
            "sources": _sources(),
            "warnings": [],
            "stale": False,
        }
        return dashboard

    def _active_plg_season_id(self, league: dict[str, Any] | None) -> int | None:
        if not league:
            return None
        for season in league.get("seasons", []):
            if season.get("active"):
                return season.get("id")
        seasons = league.get("seasons") or []
        return seasons[0].get("id") if seasons else None


def _page_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict) and isinstance(payload.get("data"), list):
        return payload["data"]
    if isinstance(payload, dict) and isinstance(payload.get("rows"), list):
        return payload["rows"]
    if isinstance(payload, list):
        return payload
    return []


def _asset_url(image_id: str | None, width: int = 96, height: int = 96) -> str | None:
    if not image_id:
        return None
    if image_id.startswith("http"):
        return image_id
    return f"{VPG_ASSET_URL}/{image_id}?width={width}&height={height}"


def _parse_vpg_datetime(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def _parse_plg_datetime(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    cleaned = value.replace("Z", "").replace(".000", "")
    local_dt = datetime.fromisoformat(cleaned).replace(tzinfo=MADRID)
    return local_dt.astimezone(timezone.utc)


def _normalize_vpg_table(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    table = []
    for idx, row in enumerate(rows, start=1):
        gf = int(row.get("score_for") or 0)
        ga = int(row.get("score_against") or 0)
        table.append(
            {
                "rank": idx,
                "team": row.get("team_name"),
                "abbr": row.get("team_abbr"),
                "slug": row.get("team_slug"),
                "logoUrl": _asset_url(row.get("team_logo"), 80, 80),
                "played": int(row.get("played") or 0),
                "wins": int(row.get("wins") or 0),
                "draws": int(row.get("draws") or 0),
                "losses": int(row.get("losses") or 0),
                "goalsFor": gf,
                "goalsAgainst": ga,
                "goalDiff": gf - ga,
                "points": int(row.get("points") or 0),
                "isKoru": row.get("team_slug") == KORU["slug"],
            }
        )
    return table


def _normalize_plg_table(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    table = []
    for idx, row in enumerate(rows, start=1):
        team = row.get("team") or {}
        table.append(
            {
                "rank": idx,
                "team": team.get("name"),
                "abbr": team.get("short_name"),
                "slug": team.get("url"),
                "logoUrl": team.get("logoSmallUrl") or team.get("logoUrl"),
                "played": int(row.get("gp") or 0),
                "wins": int(row.get("gw") or 0),
                "draws": int(row.get("gt") or 0),
                "losses": int(row.get("gl") or 0),
                "goalsFor": int(row.get("gf") or 0),
                "goalsAgainst": int(row.get("gc") or 0),
                "goalDiff": int(row.get("gd") or 0),
                "points": int(row.get("pts") or 0),
                "isKoru": team.get("id") == KORU["plg_id"] or team.get("url") == KORU["slug"],
            }
        )
    return table


def _normalize_vpg_match(match: dict[str, Any]) -> dict[str, Any]:
    is_home = match.get("home_slug") == KORU["slug"]
    home_score = _int_or_none(match.get("home_score"))
    away_score = _int_or_none(match.get("away_score"))
    score_for = home_score if is_home else away_score
    score_against = away_score if is_home else home_score
    return {
        "id": f"vpg-{match.get('id')}",
        "sourceId": match.get("id"),
        "platform": "VPG Zero" if match.get("league_slug") == "zero-gold" else "VPG",
        "competition": match.get("league_name"),
        "competitionSlug": match.get("league_slug"),
        "matchDay": match.get("match_day"),
        "datetime": _parse_vpg_datetime(match.get("datetime")).isoformat(),
        "home": match.get("home_name"),
        "away": match.get("away_name"),
        "homeLogoUrl": _asset_url(match.get("home_logo"), 80, 80),
        "awayLogoUrl": _asset_url(match.get("away_logo"), 80, 80),
        "opponent": match.get("away_name") if is_home else match.get("home_name"),
        "opponentLogoUrl": _asset_url(match.get("away_logo") if is_home else match.get("home_logo"), 80, 80),
        "isHome": is_home,
        "status": match.get("status"),
        "scoreFor": score_for,
        "scoreAgainst": score_against,
        "result": _result(score_for, score_against, match.get("status") == "complete"),
        "url": f"https://virtualprogaming.com/match/{match.get('id')}",
    }


def _normalize_plg_match(match: dict[str, Any], status: str) -> dict[str, Any]:
    home = match.get("homeTeam") or {}
    away = match.get("awayTeam") or {}
    is_home = match.get("team1") == KORU["plg_id"]
    home_score = _int_or_none(match.get("gteam1"))
    away_score = _int_or_none(match.get("gteam2"))
    score_for = home_score if is_home else away_score
    score_against = away_score if is_home else home_score
    return {
        "id": f"plg-{match.get('id')}",
        "sourceId": match.get("id"),
        "platform": "PLG",
        "competition": "REGIONAL B - PLG",
        "competitionSlug": "regional-b-plg",
        "matchDay": match.get("round"),
        "datetime": _parse_plg_datetime(match.get("date")).isoformat(),
        "home": home.get("name"),
        "away": away.get("name"),
        "homeLogoUrl": home.get("logoSmallUrl") or home.get("logoUrl"),
        "awayLogoUrl": away.get("logoSmallUrl") or away.get("logoUrl"),
        "opponent": away.get("name") if is_home else home.get("name"),
        "opponentLogoUrl": (away.get("logoSmallUrl") or away.get("logoUrl"))
        if is_home
        else (home.get("logoSmallUrl") or home.get("logoUrl")),
        "isHome": is_home,
        "status": status,
        "scoreFor": score_for,
        "scoreAgainst": score_against,
        "result": _result(score_for, score_against, status == "complete"),
        "url": f"https://www.virtualpronetwork.com/web/app/match/{match.get('id')}",
    }


def _int_or_none(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _result(score_for: int | None, score_against: int | None, complete: bool) -> str | None:
    if not complete or score_for is None or score_against is None:
        return None
    if score_for > score_against:
        return "W"
    if score_for < score_against:
        return "L"
    return "D"


def _competition_payload(
    config: dict[str, Any],
    standings: list[dict[str, Any]],
    upcoming: list[dict[str, Any]],
    recent: list[dict[str, Any]],
    league_meta: dict[str, Any],
) -> dict[str, Any]:
    koru_row = next((row for row in standings if row["isKoru"]), None)
    leaders = standings[:3]
    form = [match["result"] for match in recent if match.get("result")][:5]
    return {
        "key": config["key"],
        "name": config["name"],
        "platform": config["platform"],
        "url": config["url"],
        "accent": config["accent"],
        "logoUrl": _asset_url(league_meta.get("logo_id"), 80, 80) or league_meta.get("logoUrl"),
        "standings": standings,
        "koru": koru_row,
        "leaders": leaders,
        "form": form,
        "upcoming": upcoming,
        "recent": recent,
        "promotionTeams": int(league_meta.get("promotion_teams") or 0),
        "relegationTeams": int(league_meta.get("relegation_teams") or 0),
    }


def _team_payload(vpg: dict[str, Any], plg: dict[str, Any]) -> dict[str, Any]:
    vpg_team = vpg.get("team") or {}
    plg_team = plg.get("team") or {}
    return {
        "name": plg_team.get("name") or vpg_team.get("name") or KORU["name"],
        "abbr": plg_team.get("short_name") or vpg_team.get("abbr") or "KRU",
        "slug": KORU["slug"],
        "logoUrl": "/assets/koru-logo.png",
        "coverUrl": plg_team.get("coverUrl") or _asset_url(vpg_team.get("banner_id"), 1200, 360),
        "colors": {
            "primary": plg_team.get("primary_color") or "#f95516",
            "secondary": plg_team.get("secondary_color") or "#000000",
            "text": plg_team.get("font_color") or "#ffffff",
        },
        "socials": {
            "x": SOURCES["x"],
            "youtube": plg_team.get("youtube"),
            "instagram": plg_team.get("instagram"),
            "vpg": SOURCES["vpg_team"],
            "plg": SOURCES["plg_team"],
        },
        "eaClubName": vpg_team.get("ea_club_name") or plg_team.get("ea_id"),
    }


def _summary(competitions: list[dict[str, Any]], record: dict[str, Any]) -> dict[str, Any]:
    rows = [comp["koru"] for comp in competitions if comp.get("koru")]
    totals = {
        "played": sum(row["played"] for row in rows),
        "wins": sum(row["wins"] for row in rows),
        "draws": sum(row["draws"] for row in rows),
        "losses": sum(row["losses"] for row in rows),
        "goalsFor": sum(row["goalsFor"] for row in rows),
        "goalsAgainst": sum(row["goalsAgainst"] for row in rows),
        "points": sum(row["points"] for row in rows),
    }
    totals["goalDiff"] = totals["goalsFor"] - totals["goalsAgainst"]
    totals["winRate"] = round((totals["wins"] / totals["played"]) * 100, 1) if totals["played"] else 0
    totals["allTime"] = {
        "wins": int(record.get("wins") or 0),
        "draws": int(record.get("draws") or 0),
        "losses": int(record.get("losses") or 0),
        "trophies": int(record.get("trophies") or 0),
    }
    return totals


def _leaderboards(vpg: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    return {
        "scorers": _normalize_leaderboard(_page_rows(vpg.get("scorers")), "goals"),
        "assists": _normalize_leaderboard(_page_rows(vpg.get("assists")), "assists"),
        "ratings": _normalize_leaderboard(_page_rows(vpg.get("ratings")), "match_rating"),
    }


def _normalize_leaderboard(rows: list[dict[str, Any]], metric: str) -> list[dict[str, Any]]:
    players = []
    for idx, row in enumerate(rows, start=1):
        players.append(
            {
                "rank": idx,
                "username": row.get("username"),
                "avatarUrl": _asset_url(row.get("user_avatar"), 80, 80),
                "nationality": row.get("user_nationality"),
                "metric": metric,
                "value": row.get(metric) or row.get("points") or 0,
                "matchesPlayed": row.get("matches_played") or 0,
            }
        )
    return players


def _sources() -> list[dict[str, str]]:
    return [
        {"label": "X KORU eClub", "url": SOURCES["x"]},
        {"label": "Perfil PLG", "url": SOURCES["plg_team"]},
        {"label": "Regional B - PLG", "url": SOURCES["plg_league"]},
        {"label": "Perfil VPG", "url": SOURCES["vpg_team"]},
        {"label": "VPG Zero Gold", "url": SOURCES["vpg_zero"]},
        {"label": "VPG 4a A", "url": SOURCES["vpg_cuarta"]},
    ]


def _analytics(
    competitions: list[dict[str, Any]],
    recent_all: list[dict[str, Any]],
    leaderboards: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    team_elos = []
    for comp in competitions:
        row = comp.get("koru")
        if not row or not row.get("played"):
            continue
        played = max(1, int(row["played"]))
        win_rate = (int(row["wins"]) / played) * 100
        recent_form = [m.get("result") for m in comp.get("recent", []) if m.get("result")][:5]
        streak_bonus = sum(14 if r == "W" else 4 if r == "D" else -10 for r in recent_form)
        elo = 1300 + (int(row["points"]) * 6) + (int(row["goalDiff"]) * 2) + int(win_rate * 1.8) + streak_bonus
        team_elos.append(
            {
                "key": comp["key"],
                "platform": comp["platform"],
                "name": comp["name"],
                "elo": max(900, int(round(elo))),
                "rank": row["rank"],
                "played": row["played"],
                "form": recent_form,
            }
        )

    player_map: dict[str, dict[str, Any]] = {}
    for bucket, field in (("scorers", "goals"), ("assists", "assists"), ("ratings", "rating")):
        for player in leaderboards.get(bucket, []):
            key = str(player.get("username") or "").strip().lower()
            if not key:
                continue
            item = player_map.setdefault(
                key,
                {
                    "username": player.get("username"),
                    "avatarUrl": player.get("avatarUrl"),
                    "matchesPlayed": int(player.get("matchesPlayed") or 0),
                    "goals": 0,
                    "assists": 0,
                    "rating": 0.0,
                },
            )
            value = float(player.get("value") or 0)
            if field == "rating":
                item["rating"] = _normalized_rating(value, int(player.get("matchesPlayed") or item["matchesPlayed"] or 0))
            else:
                item[field] = int(value)
            item["matchesPlayed"] = max(item["matchesPlayed"], int(player.get("matchesPlayed") or 0))

    players = []
    for item in player_map.values():
        rating = float(item["rating"] or 0)
        elo = (
            1250
            + (item["goals"] * 14)
            + (item["assists"] * 11)
            + int(max(0.0, rating - 6.0) * 85)
            + min(90, int(item["matchesPlayed"] * 2.5))
        )
        players.append(
            {
                "username": item["username"],
                "avatarUrl": item["avatarUrl"],
                "matchesPlayed": item["matchesPlayed"],
                "goals": item["goals"],
                "assists": item["assists"],
                "rating": round(rating, 2) if rating else 0,
                "elo": int(round(elo)),
            }
        )

    player_rankings = {
        "overall": sorted(players, key=lambda p: p["elo"], reverse=True)[:20],
        "goals": sorted(players, key=lambda p: (p["goals"], p["elo"]), reverse=True)[:20],
        "assists": sorted(players, key=lambda p: (p["assists"], p["elo"]), reverse=True)[:20],
        "rating": sorted(players, key=lambda p: (p["rating"], p["elo"]), reverse=True)[:20],
    }

    current_streak = _streak(recent_all)
    last5_points = _points_last_n(recent_all, 5)

    return {
        "teamElo": sorted(team_elos, key=lambda item: item["elo"], reverse=True),
        "playerElo": player_rankings["overall"],
        "playerRankings": player_rankings,
        "summary": {
            "overallTeamElo": int(round(sum(item["elo"] for item in team_elos) / len(team_elos))) if team_elos else 0,
            "topPlayer": player_rankings["overall"][0] if player_rankings["overall"] else None,
            "currentStreak": current_streak,
            "last5Points": last5_points,
        },
    }


def _normalized_rating(value: float, matches_played: int) -> float:
    if value <= 0:
        return 0.0
    if value <= 10:
        return value
    if matches_played > 0:
        return min(10.0, value / matches_played)
    return min(10.0, value / 10)


def _streak(recent_matches: list[dict[str, Any]]) -> dict[str, Any]:
    sequence = [m.get("result") for m in recent_matches if m.get("result")]
    if not sequence:
        return {"type": "-", "count": 0}
    first = sequence[0]
    count = 0
    for value in sequence:
        if value != first:
            break
        count += 1
    return {"type": first, "count": count}


def _points_last_n(recent_matches: list[dict[str, Any]], n: int) -> int:
    points = 0
    for match in recent_matches[:n]:
        result = match.get("result")
        if result == "W":
            points += 3
        elif result == "D":
            points += 1
    return points


dashboard_service = DashboardService()
