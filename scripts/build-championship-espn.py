from __future__ import annotations

import csv
import json
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import requests

LEAGUE = "eng.2"
COMPETITION = "Championship"
SEASON_LABEL = "2025/26"
START_DATE = date(2025, 8, 1)
END_DATE = date(2026, 5, 3)  # regular season only; play-offs follow this window
BASE = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{LEAGUE}"
OUT = Path("data/championship")
CACHE = Path(".cache/championship-espn")
OUT.mkdir(parents=True, exist_ok=True)
CACHE.mkdir(parents=True, exist_ok=True)

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (compatible; footballcards-research/3.0)",
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-GB,en;q=0.9",
})


def cached_get(url: str, key: str, attempts: int = 5) -> dict[str, Any]:
    path = CACHE / f"{key}.json"
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            path.unlink(missing_ok=True)
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            response = SESSION.get(url, timeout=25)
            if response.status_code == 429:
                time.sleep(2 + attempt * 2)
                continue
            response.raise_for_status()
            data = response.json()
            path.write_text(json.dumps(data), encoding="utf-8")
            return data
        except Exception as exc:
            last = exc
            time.sleep(1 + attempt)
    raise RuntimeError(f"Failed to fetch {url}: {last}")


def day_key(day: date) -> str:
    return day.strftime("%Y%m%d")


def collect_events() -> list[dict[str, Any]]:
    days = []
    d = START_DATE
    while d <= END_DATE:
        days.append(d)
        d += timedelta(days=1)

    events: dict[str, dict[str, Any]] = {}
    failures = []

    def load_day(day: date):
        key = day_key(day)
        data = cached_get(f"{BASE}/scoreboard?dates={key}", f"scoreboard-{key}")
        return day, data.get("events") or []

    with ThreadPoolExecutor(max_workers=12) as executor:
        futures = {executor.submit(load_day, day): day for day in days}
        for future in as_completed(futures):
            day = futures[future]
            try:
                _, rows = future.result()
                for event in rows:
                    event_id = str(event.get("id") or "")
                    if event_id:
                        events[event_id] = event
            except Exception as exc:
                failures.append({"date": day.isoformat(), "error": str(exc)})

    result = sorted(events.values(), key=lambda e: (e.get("date") or "", str(e.get("id") or "")))
    if failures:
        print(f"Scoreboard date failures: {len(failures)}")
    if len(result) != 552:
        raise RuntimeError(f"Expected 552 Championship regular-season fixtures between {START_DATE} and {END_DATE}, found {len(result)}")
    return result


def event_teams(event: dict[str, Any]) -> tuple[str, str]:
    competitors = (((event.get("competitions") or [{}])[0]).get("competitors") or [])
    home = next((row for row in competitors if row.get("homeAway") == "home"), None)
    away = next((row for row in competitors if row.get("homeAway") == "away"), None)
    return str((home or {}).get("team", {}).get("displayName") or ""), str((away or {}).get("team", {}).get("displayName") or "")


def event_date(event: dict[str, Any]) -> str:
    return str(event.get("date") or "")[:10]


def stats_map(row: dict[str, Any]) -> dict[str, float]:
    result = {}
    for stat in row.get("stats") or []:
        name = stat.get("name")
        value = stat.get("value")
        if not name or value is None:
            continue
        try:
            result[str(name)] = float(value)
        except Exception:
            pass
    return result


def clock_minute(play: dict[str, Any]) -> int | None:
    value = (play.get("clock") or {}).get("value")
    try:
        # ESPN clock value is seconds into the match.
        return max(0, min(90, int(float(value) // 60)))
    except Exception:
        return None


def participation_minutes(summary: dict[str, Any]) -> dict[str, int]:
    entered: dict[str, int] = {}
    left: dict[str, int] = {}
    starters: set[str] = set()

    for section in summary.get("rosters") or []:
        for row in section.get("roster") or []:
            athlete_id = str((row.get("athlete") or {}).get("id") or "")
            if not athlete_id:
                continue
            if row.get("starter") is True:
                starters.add(athlete_id)
                entered[athlete_id] = 0

    plays = summary.get("keyEvents") or summary.get("plays") or []
    for play in plays:
        play_type = str((play.get("type") or {}).get("type") or "").lower()
        minute = clock_minute(play)
        if minute is None:
            continue
        participants = play.get("participants") or []
        ids = [str((p.get("athlete") or {}).get("id") or "") for p in participants]
        ids = [p for p in ids if p]
        if play_type == "substitution" and ids:
            # ESPN lists the incoming player first, outgoing player second.
            entered.setdefault(ids[0], minute)
            if len(ids) > 1:
                left[ids[1]] = minute
        elif play_type in {"red-card", "red_card", "second-yellow-card", "second-yellow-red-card"} and ids:
            left[ids[0]] = minute

    minutes = {}
    appeared = set(entered) | starters
    for athlete_id in appeared:
        start = entered.get(athlete_id, 0 if athlete_id in starters else 90)
        end = left.get(athlete_id, 90)
        minutes[athlete_id] = max(1, min(90, end) - max(0, min(90, start)))
    return minutes


def referee_from(summary: dict[str, Any]) -> str:
    officials = (summary.get("gameInfo") or {}).get("officials") or summary.get("officials") or []
    for official in officials:
        name = official.get("displayName") or official.get("fullName")
        if name:
            return str(name)
    return ""


def parse_event(event: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    event_id = str(event["id"])
    summary = cached_get(f"{BASE}/summary?event={event_id}", f"summary-{event_id}")
    home, away = event_teams(event)
    date_value = event_date(event)
    minutes_by_player = participation_minutes(summary)
    referee = referee_from(summary)
    player_rows = []

    for section in summary.get("rosters") or []:
        side = str(section.get("homeAway") or "")
        team = str((section.get("team") or {}).get("displayName") or (home if side == "home" else away))
        opponent = away if side == "home" else home
        venue = "home" if side == "home" else "away"
        for row in section.get("roster") or []:
            athlete = row.get("athlete") or {}
            athlete_id = str(athlete.get("id") or "")
            player_name = str(athlete.get("displayName") or athlete.get("fullName") or "")
            stats = stats_map(row)
            appeared = stats.get("appearances", 0) > 0 or row.get("starter") is True or row.get("subbedIn") is True
            if not athlete_id or not player_name or not appeared:
                continue
            minutes = minutes_by_player.get(athlete_id)
            if minutes is None:
                minutes = 90 if row.get("starter") is True else 1
            player_rows.append({
                "player_name": player_name,
                "team": team,
                "opponent": opponent,
                "match_date": date_value,
                "competition": COMPETITION,
                "venue": venue,
                "minutes": minutes,
                "fouls_committed": int(stats.get("foulsCommitted", 0)),
                "fouls_drawn": int(stats.get("foulsSuffered", 0)),
                "yellow_card": 1 if stats.get("yellowCards", 0) > 0 else 0,
                "red_card": 1 if stats.get("redCards", 0) > 0 else 0,
                "external_player_id": athlete_id,
                "position": str((row.get("position") or {}).get("displayName") or (row.get("position") or {}).get("abbreviation") or ""),
                "starter": row.get("starter") is True,
                "_referee": referee,
            })

    return player_rows, {
        "event_id": event_id,
        "date": date_value,
        "home": home,
        "away": away,
        "referee": referee,
        "players": len(player_rows),
    }


def write_csv(path: Path, headers: list[str], rows: list[dict[str, Any]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=headers, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    events = collect_events()
    print(f"Discovered {len(events)} Championship regular-season fixtures")

    all_rows: list[dict[str, Any]] = []
    event_meta: list[dict[str, Any]] = []
    failures = []

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(parse_event, event): event for event in events}
        completed = 0
        for future in as_completed(futures):
            event = futures[future]
            completed += 1
            try:
                rows, meta = future.result()
                all_rows.extend(rows)
                event_meta.append(meta)
            except Exception as exc:
                failures.append({"event_id": event.get("id"), "date": event_date(event), "error": str(exc)})
            if completed % 50 == 0:
                print(f"Processed {completed}/552 matches; rows={len(all_rows)} failures={len(failures)}")

    all_rows.sort(key=lambda r: (r["match_date"], r["team"], r["player_name"]))

    by_player: dict[tuple[str, str, str], dict[str, Any]] = {}
    for row in all_rows:
        key = (row["external_player_id"], row["player_name"], row["team"])
        rec = by_player.setdefault(key, {
            "player_name": row["player_name"], "team": row["team"], "competition": COMPETITION, "season": SEASON_LABEL,
            "appearances": 0, "starts": 0, "minutes": 0, "yellow_cards": 0, "red_cards": 0,
            "fouls_committed": 0, "fouls_drawn": 0, "position": row["position"], "external_player_id": row["external_player_id"],
        })
        rec["appearances"] += 1
        rec["starts"] += int(row["starter"])
        rec["minutes"] += int(row["minutes"])
        rec["yellow_cards"] += int(row["yellow_card"])
        rec["red_cards"] += int(row["red_card"])
        rec["fouls_committed"] += int(row["fouls_committed"])
        rec["fouls_drawn"] += int(row["fouls_drawn"])
        if not rec["position"] and row["position"]:
            rec["position"] = row["position"]

    baselines = []
    for rec in by_player.values():
        p90 = rec["minutes"] / 90 if rec["minutes"] else 0
        baselines.append({
            **{k: rec[k] for k in ["player_name", "team", "competition", "season", "appearances", "starts", "minutes", "yellow_cards", "red_cards", "fouls_committed", "fouls_drawn"]},
            "fouls_per_90": round(rec["fouls_committed"] / p90, 4) if p90 else None,
            "cards_per_90": round(rec["yellow_cards"] / p90, 4) if p90 else None,
            "position": rec["position"], "external_player_id": rec["external_player_id"],
        })
    baselines.sort(key=lambda r: (r["team"], r["player_name"]))

    matches_by_ref = Counter(meta["referee"] for meta in event_meta if meta["referee"])
    ref_totals = defaultdict(lambda: {"yellow": 0, "red": 0, "fouls": 0})
    player_ref = defaultdict(lambda: {"matches": 0, "yellow": 0, "red": 0, "fouls": 0, "teams": Counter()})
    for row in all_rows:
        ref = row["_referee"]
        if not ref:
            continue
        ref_totals[ref]["yellow"] += row["yellow_card"]
        ref_totals[ref]["red"] += row["red_card"]
        ref_totals[ref]["fouls"] += row["fouls_committed"]
        key = (ref, row["external_player_id"], row["player_name"])
        rec = player_ref[key]
        rec["matches"] += 1
        rec["yellow"] += row["yellow_card"]
        rec["red"] += row["red_card"]
        rec["fouls"] += row["fouls_committed"]
        rec["teams"][row["team"]] += 1

    referee_rows = []
    for ref, matches in sorted(matches_by_ref.items()):
        t = ref_totals[ref]
        referee_rows.append({
            "referee_name": ref, "matches_refereed": matches, "yellow_cards": t["yellow"], "red_cards": t["red"],
            "yellows_per_game": round(t["yellow"] / matches, 4), "fouls_per_game": round(t["fouls"] / matches, 4),
            "competition": COMPETITION, "season": SEASON_LABEL, "external_referee_id": "",
        })

    player_ref_rows = []
    for (ref, player_id, player_name), rec in sorted(player_ref.items()):
        team = rec["teams"].most_common(1)[0][0]
        player_ref_rows.append({
            "referee_name": ref, "player_name": player_name, "team": team, "competition": COMPETITION, "season": SEASON_LABEL,
            "matches_together": rec["matches"], "yellow_cards": rec["yellow"], "red_cards": rec["red"],
            "fouls_committed": rec["fouls"], "external_referee_id": "", "external_player_id": player_id,
        })

    h2h_rows = [{k: row[k] for k in ["player_name", "team", "opponent", "match_date", "competition", "venue", "minutes", "fouls_committed", "fouls_drawn", "yellow_card", "red_card", "external_player_id"]} for row in all_rows]

    write_csv(OUT / "player_baselines.csv", ["player_name", "team", "competition", "season", "appearances", "starts", "minutes", "yellow_cards", "red_cards", "fouls_committed", "fouls_drawn", "fouls_per_90", "cards_per_90", "position", "external_player_id"], baselines)
    write_csv(OUT / "h2h.csv", ["player_name", "team", "opponent", "match_date", "competition", "venue", "minutes", "fouls_committed", "fouls_drawn", "yellow_card", "red_card", "external_player_id"], h2h_rows)
    write_csv(OUT / "referees.csv", ["referee_name", "matches_refereed", "yellow_cards", "red_cards", "yellows_per_game", "fouls_per_game", "competition", "season", "external_referee_id"], referee_rows)
    write_csv(OUT / "player_referee_history.csv", ["referee_name", "player_name", "team", "competition", "season", "matches_together", "yellow_cards", "red_cards", "fouls_committed", "external_referee_id", "external_player_id"], player_ref_rows)

    report = {
        "source": "ESPN public soccer scoreboard and match-summary APIs",
        "competition": COMPETITION, "season": SEASON_LABEL,
        "counts": {
            "regular_season_events": len(events), "events_processed": len(event_meta), "events_failed": len(failures),
            "events_with_referee": sum(1 for m in event_meta if m["referee"]), "player_baselines": len(baselines),
            "h2h_player_match_rows": len(h2h_rows), "referees": len(referee_rows), "player_referee_rows": len(player_ref_rows),
        },
        "failures": failures[:100],
    }
    (OUT / "quality-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    c = report["counts"]
    if c["regular_season_events"] != 552 or c["events_failed"] > 5 or c["player_baselines"] < 450 or c["h2h_player_match_rows"] < 9000 or c["referees"] < 15 or c["player_referee_rows"] < 2500:
        raise RuntimeError(f"Championship quality gate failed: {c}")
    print(json.dumps(c, indent=2))


if __name__ == "__main__":
    main()
