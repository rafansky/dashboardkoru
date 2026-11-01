"""POTW v2: appearances and per-match EA notes, compared by platform and role."""
from collections import defaultdict
from datetime import datetime, timedelta
from math import ceil, isfinite
from statistics import mean
from zoneinfo import ZoneInfo

MADRID = ZoneInfo("Europe/Madrid")
VERSION = "koru-potw-v2-appearances"
ROLES = {"goalkeeper", "defender", "midfielder", "forward"}


def week_of(value):
    day = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(MADRID).date()
    return (day - timedelta(days=day.weekday())).isoformat()


def number(value, default=0):
    try:
        value = float(value)
        return value if isfinite(value) else default
    except (ValueError, TypeError):
        return default


def metrics(player):
    # A submitted lineup establishes presence even after a disconnected match.
    # Duration and action totals never determine appearances or weight a score.
    ea, events = player.get("ea") or {}, player.get("stats") or {}
    role = (player.get("position") or {}).get("group")
    rating = number(ea.get("rating"), -1)
    return dict(valid=role in ROLES and 0 < rating <= 10, role=role,
                rating=rating if 0 < rating <= 10 else None,
                penalty=8 * max(0, number(events.get("6"))),
                goals=max(0, number(events.get("1"))), assists=max(0, number(events.get("2"))),
                saves=number(ea.get("saves"), None), passesMade=number(ea.get("passesMade"), None),
                passAttempts=number(ea.get("passAttempts"), None),
                tacklesMade=number(ea.get("tacklesMade"), None), tackleAttempts=number(ea.get("tackleAttempts"), None))


def percentile(value, pool):
    if len(pool) < 4:
        return 50.0
    return 100 * (sum(x < value for x in pool) + .5 * sum(x == value for x in pool)) / len(pool)


def rank_week(fixtures, reports, team_id):
    """Count known lineups; invalid EA notes stay pending, never become zeroes."""
    pools, entries, matches, seen_matches = defaultdict(list), [], [], set()
    for fixture in fixtures:
        mid, platform = fixture["id"], fixture.get("platform", "PLG")
        if (platform, mid) in seen_matches:
            continue
        seen_matches.add((platform, mid))
        report = reports.get(mid)
        forfeited = bool(fixture.get("forfeit") or (report and report["match"].get("forfeit")))
        played = bool(fixture.get("published") or fixture.get("played")) and not forfeited
        side = next((report[k] for k in ("home", "away") if report[k]["teamId"] == team_id), None) if report else None
        lineup = side.get("players", []) if side and played else []
        ready = bool(lineup) and all(metrics(p)["valid"] for p in lineup)
        match = dict(id=mid, round=fixture["round"], date=fixture["date"],
                     opponent=fixture.get("opponent", ""), platform=platform, ready=ready,
                     played=played, forfeit=forfeited, lineupKnown=bool(lineup),
                     score=report["match"].get("score") if report else None,
                     url=fixture.get("url") or f"https://virtualpronetwork.com/es/matches/{mid}")
        matches.append(match)
        if not lineup:
            continue
        for key in ("home", "away"):
            seen_players = set()
            for player in report[key]["players"]:
                pid = str(player["userId"])
                if pid in seen_players:
                    continue
                seen_players.add(pid)
                data = metrics(player)
                # An incomplete club report stays pending as a whole. Keep the
                # lineup appearances, but don't give some players a scoring game
                # that their teammates are still missing from the same report.
                data["valid"] = data["valid"] and ready
                if data["valid"]:
                    pools[(platform, data["role"])].append(data["rating"])
                if report[key]["teamId"] == team_id:
                    entries.append((match, player, data))
    players = {}
    for match, player, data in entries:
        pid = str(player["userId"])
        item = players.setdefault(pid, dict(id=pid, name=player["name"], appearances=0,
                    ratedAppearances=0, pendingAppearances=0, games=[], goals=0, assists=0, saves=0))
        item["name"] = player["name"]
        item["appearances"] += 1
        points = None
        peers = pools[(match["platform"], data["role"])]
        if data["valid"]:
            points = max(0, percentile(data["rating"], peers) - data["penalty"])
            item["ratedAppearances"] += 1
        else:
            item["pendingAppearances"] += 1
        item["games"].append(dict(matchId=match["id"], platform=match["platform"],
                opponent=match["opponent"], url=match["url"], position=(player.get("position") or {}).get("code", "—"),
                score=round(points, 4) if points is not None else None,
                ratingPoints=round(percentile(data["rating"], peers), 2) if data["valid"] else None,
                peers=len(peers), **data))
        for key in ("goals", "assists", "saves"):
            item[key] += data[key] or 0
    played = sum(m["played"] for m in matches)
    minimum_games = max(1, ceil(played * .50))
    for item in players.values():
        rated = [g for g in item["games"] if g["valid"]]
        item["eligible"] = item["appearances"] >= minimum_games and bool(rated)
        item["eligibilityReason"] = ("Nota EA pendiente" if not rated else
                                     "Participación insuficiente" if not item["eligible"] else "Candidato")
        item["performance"] = round(mean(g["score"] for g in rated), 4) if rated else None
        item["rating"] = round(mean(g["rating"] for g in rated), 3) if rated else None
        item["teamMatches"] = played
    ordered = sorted(players.values(), key=lambda p: (-(p["performance"] if p["performance"] is not None else -1),
                                                       -p["appearances"], p["id"]))
    scored = sum(m["ready"] and m["played"] for m in matches)
    coverage = dict(totalMatches=sum(not m["forfeit"] for m in matches), playedMatches=played,
                    scoredMatches=scored, pendingMatches=played-scored,
                    scheduledMatches=sum(not m["played"] and not m["forfeit"] for m in matches),
                    excludedMatches=sum(m["forfeit"] for m in matches))
    by_platform = {p: dict(played=sum(m["played"] for m in matches if m["platform"] == p),
                          scored=sum(m["ready"] and m["played"] for m in matches if m["platform"] == p))
                   for p in sorted({m["platform"] for m in matches})}
    return dict(version=VERSION, players=ordered, matches=matches, minimumGames=minimum_games,
                coverage=coverage, byPlatform=by_platform,
                complete=bool(played) and all(m["ready"] or m["forfeit"] for m in matches))


def results(snapshot, ballots, voter_count, closed=False):
    quorum = max(3, ceil(voter_count / 2))
    use_votes = closed and len(ballots) >= quorum
    points = defaultdict(int)
    cast_by = {ballot["playerId"] for ballot in ballots}
    for ballot in ballots:
        for rank, pid in enumerate(ballot["choices"]):
            points[pid] += 3 - rank
    rows = []
    for player in snapshot["players"]:
        p = dict(player)
        # A candidate's own ballot cannot support them: exclude it from their
        # denominator so voting does not dilute their own measured support.
        possible = 3 * (len(ballots) - int(p["id"] in cast_by))
        support = 100 * points[p["id"]] / max(1, possible)
        p.update(votePoints=points[p["id"]] if closed else None,
                 voteScore=round(support, 2) if closed else None,
                 finalScore=(round(.8 * p["performance"] + .2 * support, 4) if use_votes else p["performance"]) if p["performance"] is not None else None)
        rows.append(p)
    rows.sort(key=lambda p: (-(p["finalScore"] if p["finalScore"] is not None else -1), -(p["performance"] if p["performance"] is not None else -1), -p["appearances"], str(p["id"])))
    eligible = [p for p in rows if p["eligible"]]
    # Exact merit ties share the award; IDs only give a stable display order.
    winners = [p["id"] for p in eligible if (p["finalScore"], p["performance"], p["appearances"]) ==
               (eligible[0]["finalScore"], eligible[0]["performance"], eligible[0]["appearances"])] if eligible else []
    return dict(players=rows, winners=winners, ballots=len(ballots), voters=voter_count,
                quorum=quorum, votesApplied=use_votes)
