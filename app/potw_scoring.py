"""Auditable POTW v1: role-relative performances, then a separate team ballot."""
from collections import defaultdict
from datetime import datetime, timedelta
from math import ceil, isfinite
from statistics import mean
from zoneinfo import ZoneInfo

MADRID = ZoneInfo("Europe/Madrid")
VERSION = "koru-potw-v1"
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
    ea = player.get("ea") or {}
    events = player.get("stats") or {}
    minutes = max(0, min(90, number(ea.get("minutes"))))
    role = (player.get("position") or {}).get("group")
    rating = number(ea.get("rating"), -1)
    required = ("minutes", "rating", "passesMade", "passAttempts", "tacklesMade", "tackleAttempts", "saves")
    valid = (role in ROLES and 0 < rating <= 10 and minutes >= 30
             and all(number(ea.get(k), -1) >= 0 for k in required))
    # Stabilise short appearances and percentages; no 1/1 passing superstar.
    rate = 90 / max(60, minutes)
    passed, attempted = max(0, number(ea.get("passesMade"))), max(0, number(ea.get("passAttempts")))
    tackled, attempts = max(0, number(ea.get("tacklesMade"))), max(0, number(ea.get("tackleAttempts")))
    passing = 70 * min(1, (passed + 7) / (max(passed, attempted) + 10)) + 30 * min(1, passed * rate / 35)
    defending = 60 * min(1, tackled * rate / 5) + 40 * (tackled + 1) / (max(tackled, attempts) + 2)
    goals, assists = number(events.get("1")), number(events.get("2"))
    attack = min(100, (goals * 55 + assists * 40) * rate)
    clean = bool(number(events.get("3")) or number(events.get("7")))
    if role == "goalkeeper":
        contribution = 65 * min(1, number(ea.get("saves")) * rate / 8) + 20 * clean + .15 * passing
    elif role == "defender":
        contribution = .55 * defending + .25 * passing + 10 * clean + .10 * attack
    elif role == "midfielder":
        contribution = .40 * passing + .30 * defending + .30 * attack
    else:
        contribution = .70 * attack + .20 * passing + .10 * defending
    penalty = 2 * number(events.get("5")) + 8 * number(events.get("6"))
    return dict(valid=valid, role=role, minutes=minutes, rating=rating, contribution=contribution,
                penalty=penalty, goals=goals, assists=assists, saves=number(ea.get("saves")),
                passesMade=passed, passAttempts=attempted, tacklesMade=tackled, tackleAttempts=attempts)


def percentile(value, pool):
    # Midrank handles ties equally. With insufficient peers use the neutral mark.
    if len(pool) < 4:
        return 50.0
    return 100 * (sum(x < value for x in pool) + .5 * sum(x == value for x in pool)) / len(pool)


def rank_week(fixtures, reports, team_id):
    """Use both sides of this week's reported games; never season totals/future games."""
    pools = defaultdict(list)
    entries = []
    matches = []
    for fixture in fixtures:
        mid = fixture["id"]
        report = reports.get(mid)
        forfeited = bool(fixture.get("forfeit") or (report and report["match"].get("forfeit")))
        ready = bool(fixture.get("published") and report and report["match"].get("published") and not forfeited)
        side = None
        if ready:
            side = next((report[k] for k in ("home", "away") if report[k]["teamId"] == team_id), None)
            ready = bool(side and side.get("players") and all(
                p.get("ea") and "minutes" in p["ea"] and
                (number(p["ea"]["minutes"]) < 30 or metrics(p)["valid"]) for p in side["players"]))
            ready = ready and any(metrics(p)["valid"] for p in side["players"])
        matches.append(dict(id=mid, round=fixture["round"], date=fixture["date"],
                            opponent=fixture.get("opponent", ""), ready=ready,
                            forfeit=forfeited, score=report["match"].get("score") if report else None,
                            url=f"https://virtualpronetwork.com/es/matches/{mid}"))
        if not ready:
            continue
        for key in ("home", "away"):
            for player in report[key]["players"]:
                data = metrics(player)
                if data["valid"]:
                    pools[data["role"]].append(data)
                if key == ("home" if report["home"]["teamId"] == team_id else "away"):
                    entries.append((mid, player, data))
    players = {}
    for mid, player, data in entries:
        pid = str(player["userId"])
        item = players.setdefault(pid, dict(id=pid, name=player["name"], appearances=0, minutes=0,
                                           games=[], goals=0, assists=0, saves=0))
        item["name"] = player["name"]
        if not data["valid"]:
            continue
        peers = pools[data["role"]]
        rating_points = percentile(data["rating"], [p["rating"] for p in peers])
        contribution_points = percentile(data["contribution"], [p["contribution"] for p in peers])
        score = max(0, .70 * rating_points + .30 * contribution_points - data["penalty"])
        item["games"].append(dict(matchId=mid, position=player["position"]["code"],
                                  score=round(score, 4), ratingPoints=round(rating_points, 2),
                                  contributionPoints=round(contribution_points, 2), peers=len(peers), **data))
        item["appearances"] += 1
        item["minutes"] += data["minutes"]
        for key in ("goals", "assists", "saves"):
            item[key] += data[key]
    count = sum(not m["forfeit"] for m in matches)
    minimum_games, minimum_minutes = max(1, ceil(count * .60)), count * 90 * .60
    for item in players.values():
        item["eligible"] = item["appearances"] >= minimum_games and item["minutes"] >= minimum_minutes
        item["performance"] = round(sum(g["score"] * g["minutes"] for g in item["games"]) / max(1, item["minutes"]), 4)
        item["rating"] = round(mean(g["rating"] for g in item["games"]), 3) if item["games"] else None
    ordered = sorted(players.values(), key=lambda p: (-p["performance"], -p["minutes"], int(p["id"])))
    return dict(version=VERSION, players=ordered, matches=matches, minimumGames=minimum_games,
                minimumMinutes=minimum_minutes, complete=bool(count) and all(m["ready"] or m["forfeit"] for m in matches))


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
                 finalScore=round(.8 * p["performance"] + .2 * support, 4) if use_votes else p["performance"])
        rows.append(p)
    rows.sort(key=lambda p: (-p["finalScore"], -p["performance"], -p["minutes"], int(p["id"])))
    eligible = [p for p in rows if p["eligible"]]
    # Exact merit ties share the award; IDs only give a stable display order.
    winners = [p["id"] for p in eligible if (p["finalScore"], p["performance"], p["minutes"]) ==
               (eligible[0]["finalScore"], eligible[0]["performance"], eligible[0]["minutes"])] if eligible else []
    return dict(players=rows, winners=winners, ballots=len(ballots), voters=voter_count,
                quorum=quorum, votesApplied=use_votes)
