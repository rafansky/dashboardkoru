"""Season-scoped player totals from individual VPN reports, never career totals."""
def player_statistics(fixtures, reports, team_id, season_id):
    players = {}
    reported = set()
    expected = set()
    for fixture in sorted(fixtures, key=lambda f: (f["date"], f["id"])):
        mid = fixture["id"]
        if fixture.get("season") != season_id or not fixture.get("published") or fixture.get("forfeit"):
            continue
        expected.add(mid)
        report = reports.get(mid)
        if (mid in reported or not report or not report["match"].get("published")
                or report["match"].get("forfeit") or report["competition"].get("seasonId") != season_id):
            continue
        side = next((report[key] for key in ("home", "away") if report[key]["teamId"] == team_id), None)
        if not side or not side.get("players"):
            continue
        reported.add(mid)
        seen = set()
        for p in side["players"]:
            pid = str(p["userId"])
            ea = p.get("ea") or {}
            if pid in seen or ("minutes" in ea and (ea["minutes"] or 0) <= 0):
                continue
            seen.add(pid)
            item = players.setdefault(pid, dict(key=f"plg:{pid}", playerId=pid, platform="PLG", username=p["name"],
                                                avatarUrl=p.get("avatarUrl"), matchesPlayed=0, goals=0, assists=0,
                                                saves=0, cleanSheets=0, ratingTotal=0, ratingGames=0))
            item["username"] = p["name"]
            item["avatarUrl"] = p.get("avatarUrl") or item["avatarUrl"]
            item["matchesPlayed"] += 1
            stats = p.get("stats") or {}
            item["goals"] += max(0, int(stats.get("1") or 0))
            item["assists"] += max(0, int(stats.get("2") or 0))
            item["cleanSheets"] += int(bool(stats.get("3") or stats.get("7")))
            item["saves"] += max(0, int(ea.get("saves") or 0))
            rating = ea.get("rating")
            if isinstance(rating, (float, int)) and 0 < rating <= 10:
                item["ratingTotal"] += rating
                item["ratingGames"] += 1
    rows = []
    for item in players.values():
        item["rating"] = round(item.pop("ratingTotal") / item["ratingGames"], 4) if item["ratingGames"] else None
        rows.append(item)
    leaders = {}
    for bucket, metric in (("scorers", "goals"), ("assists", "assists"), ("ratings", "rating")):
        ordered = sorted((p for p in rows if p[metric] is not None),
                         key=lambda p: (-p[metric], -p["matchesPlayed"], p["key"]))
        leaders[bucket] = [dict(p, rank=i, metric=metric, value=p[metric]) for i, p in enumerate(ordered, 1)]
    return dict(leaderboards=leaders, reportedMatches=len(reported), expectedMatches=len(expected),
                seasonId=season_id, players=rows)


def combine_leaders(*sources):
    combined = {}
    for bucket in ("scorers", "assists", "ratings"):
        rows = [dict(p) for source in sources for p in source.get(bucket, [])]
        for p in rows:
            p["value"] = float(p["value"])
        # VPG sometimes supplies a sum of ratings; compare average against average.
        if bucket == "ratings":
            for p in rows:
                if p["value"] > 10:
                    p["value"] = min(10, p["value"] / max(1, p["matchesPlayed"]))
        rows.sort(key=lambda p: (-p["value"], -p["matchesPlayed"], p.get("key", p["username"])))
        combined[bucket] = [dict(p, rank=i) for i, p in enumerate(rows, 1)]
    return combined
