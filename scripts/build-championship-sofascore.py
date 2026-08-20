from __future__ import annotations

import csv
import json
import math
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

API = "https://www.sofascore.com/api/v1"
TOURNAMENT_ID = 18
SEASON_ID = 77347
COMPETITION = "Championship"
SEASON_LABEL = "2025/26"
OUT = Path("data/championship")
CACHE = Path(".cache/championship-sofascore")
OUT.mkdir(parents=True, exist_ok=True)
CACHE.mkdir(parents=True, exist_ok=True)

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (compatible; footballcards-research/2.0)",
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-GB,en;q=0.9",
    "Referer": "https://www.sofascore.com/",
})

TEAM_ALIASES = {
    "Blackburn Rovers": "Blackburn Rovers",
    "Bristol City": "Bristol City",
    "Birmingham City": "Birmingham City",
    "Charlton Athletic": "Charlton Athletic",
    "Coventry City": "Coventry City",
    "Derby County": "Derby County",
    "Hull City": "Hull City",
    "Ipswich Town": "Ipswich Town",
    "Leicester City": "Leicester City",
    "Middlesbrough": "Middlesbrough",
    "Millwall": "Millwall",
    "Norwich City": "Norwich City",
    "Oxford United": "Oxford United",
    "Portsmouth": "Portsmouth",
    "Preston North End": "Preston North End",
    "Queens Park Rangers": "Queens Park Rangers",
    "Sheffield United": "Sheffield United",
    "Sheffield Wednesday": "Sheffield Wednesday",
    "Southampton": "Southampton",
    "Stoke City": "Stoke City",
    "Swansea City": "Swansea City",
    "Watford": "Watford",
    "West Bromwich Albion": "West Bromwich Albion",
    "Wrexham": "Wrexham",
}


def clean_team(name: str | None) -> str:
    value = " ".join((name or "").split())
    return TEAM_ALIASES.get(value, value)


def cache_path(key: str) -> Path:
    safe = key.replace("/", "_")
    return CACHE / f"{safe}.json"


def fetch_json(path: str, key: str, attempts: int = 7) -> dict[str, Any]:
    cached = cache_path(key)
    if cached.exists():
        try:
            return json.loads(cached.read_text(encoding="utf-8"))
        except Exception:
            cached.unlink(missing_ok=True)

    url = f"{API}{path}"
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            response = SESSION.get(url, timeout=35)
            if response.status_code in (403, 429):
                wait = min(60, 4 * (attempt + 1))
                print(f"{response.status_code} {path}; retrying in {wait}s")
                time.sleep(wait)
                continue
            response.raise_for_status()
            data = response.json()
            cached.write_text(json.dumps(data), encoding="utf-8")
            return data
        except Exception as exc:
            last = exc
            time.sleep(min(30, 2 * (attempt + 1)))
    raise RuntimeError(f"Failed to fetch {url}: {last}")


def event_date(event: dict[str, Any]) -> str:
    ts = event.get("startTimestamp")
    if not ts:
        return ""
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%Y-%m-%d")


def get_regular_events() -> list[dict[str, Any]]:
    events: dict[int, dict[str, Any]] = {}
    round_counts = {}
    for round_no in range(1, 47):
        data = fetch_json(
            f"/unique-tournament/{TOURNAMENT_ID}/season/{SEASON_ID}/events/round/{round_no}",
            f"round-{round_no}",
        )
        rows = data.get("events") or []
        round_counts[round_no] = len(rows)
        for event in rows:
            event_id = event.get("id")
            if event_id:
                events[int(event_id)] = event
    result = sorted(events.values(), key=lambda e: (e.get("startTimestamp") or 0, e.get("id") or 0))
    if len(result) != 552:
        raise RuntimeError(f"Expected exactly 552 Championship regular-season events, found {len(result)}; round counts={round_counts}")
    return result


def incident_cards(data: dict[str, Any]) -> dict[int, dict[str, int]]:
    cards: dict[int, dict[str, int]] = defaultdict(lambda: {"yellow": 0, "red": 0})
    for incident in data.get("incidents") or []:
        player = incident.get("player") or {}
        pid = player.get("id")
        if not pid:
            continue
        incident_type = str(incident.get("incidentType") or "").lower()
        incident_class = str(incident.get("incidentClass") or incident.get("class") or "").lower()
        if incident_type != "card" and "card" not in incident_type:
            continue
        if "yellow" in incident_class:
            cards[int(pid)]["yellow"] += 1
        if "red" in incident_class:
            cards[int(pid)]["red"] += 1
        # SofaScore sometimes calls a second-yellow dismissal yellowRed.
        if "yellowred" in incident_class.replace("-", ""):
            cards[int(pid)]["yellow"] = max(cards[int(pid)]["yellow"], 1)
            cards[int(pid)]["red"] = max(cards[int(pid)]["red"], 1)
    return cards


def extract_referee(event: dict[str, Any], detail: dict[str, Any]) -> tuple[str, str]:
    candidates = [
        detail.get("event", {}).get("referee"),
        detail.get("referee"),
        event.get("referee"),
    ]
    for ref in candidates:
        if isinstance(ref, dict) and ref.get("name"):
            return str(ref["name"]), str(ref.get("id") or "")
    return "", ""


def stat_int(stats: dict[str, Any], *keys: str) -> int | None:
    for key in keys:
        value = stats.get(key)
        if value is None:
            continue
        try:
            if isinstance(value, str) and value.endswith("%"): value = value[:-1]
            return int(round(float(value)))
        except Exception:
            continue
    return None


def parse_side(
    entries: list[dict[str, Any]],
    *,
    event: dict[str, Any],
    team: str,
    opponent: str,
    venue: str,
    referee: str,
    referee_id: str,
    cards: dict[int, dict[str, int]],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    date = event_date(event)
    for entry in entries:
        player = entry.get("player") or {}
        pid = player.get("id")
        name = player.get("name")
        if not pid or not name:
            continue
        stats = entry.get("statistics") or {}
        minutes = stat_int(stats, "minutesPlayed", "minutes")
        substitute = bool(entry.get("substitute", False))
        starter = not substitute

        # Ignore unused substitutes. Starters with a missing minutes field are
        # retained and marked 90 only as a last-resort coverage fallback; the
        # quality report records these so they cannot be hidden silently.
        if minutes is None:
            if not starter:
                continue
            minutes = 90
            minutes_inferred = True
        else:
            minutes_inferred = False
        if minutes <= 0:
            continue

        card = cards.get(int(pid), {"yellow": 0, "red": 0})
        yellow = stat_int(stats, "yellowCards")
        red = stat_int(stats, "redCards")
        yellow = max(yellow or 0, card["yellow"])
        red = max(red or 0, card["red"])

        rows.append({
            "player_name": str(name),
            "team": clean_team(team),
            "opponent": clean_team(opponent),
            "match_date": date,
            "competition": COMPETITION,
            "venue": venue,
            "minutes": minutes,
            "fouls_committed": stat_int(stats, "fouls"),
            "fouls_drawn": stat_int(stats, "wasFouled", "fouled"),
            "yellow_card": 1 if yellow > 0 else 0,
            "red_card": 1 if red > 0 else 0,
            "external_player_id": str(pid),
            "position": player.get("position") or entry.get("position") or "",
            "starter": starter,
            "_referee": referee,
            "_referee_id": referee_id,
            "_minutes_inferred": minutes_inferred,
        })
    return rows


def load_event(event: dict[str, Any]) -> tuple[int, list[dict[str, Any]], dict[str, Any]]:
    event_id = int(event["id"])
    lineups = fetch_json(f"/event/{event_id}/lineups", f"event-{event_id}-lineups")
    incidents = fetch_json(f"/event/{event_id}/incidents", f"event-{event_id}-incidents")
    try:
        detail = fetch_json(f"/event/{event_id}", f"event-{event_id}-detail")
    except Exception:
        detail = {}

    home = clean_team((event.get("homeTeam") or {}).get("name"))
    away = clean_team((event.get("awayTeam") or {}).get("name"))
    referee, referee_id = extract_referee(event, detail)
    cards = incident_cards(incidents)
    home_entries = ((lineups.get("home") or {}).get("players") or [])
    away_entries = ((lineups.get("away") or {}).get("players") or [])

    rows = []
    rows.extend(parse_side(home_entries, event=event, team=home, opponent=away, venue="home", referee=referee, referee_id=referee_id, cards=cards))
    rows.extend(parse_side(away_entries, event=event, team=away, opponent=home, venue="away", referee=referee, referee_id=referee_id, cards=cards))

    meta = {
        "event_id": event_id,
        "date": event_date(event),
        "home": home,
        "away": away,
        "referee": referee,
        "players": len(rows),
        "inferred_minutes": sum(1 for row in rows if row["_minutes_inferred"]),
        "has_home_lineup": bool(home_entries),
        "has_away_lineup": bool(away_entries),
    }
    return event_id, rows, meta


def write_csv(path: Path, headers: list[str], rows: list[dict[str, Any]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=headers, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    events = get_regular_events()
    print(f"Loaded {len(events)} regular-season Championship events")

    all_rows: list[dict[str, Any]] = []
    event_meta: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = {executor.submit(load_event, event): event for event in events}
        done = 0
        for future in as_completed(futures):
            event = futures[future]
            done += 1
            try:
                _, rows, meta = future.result()
                all_rows.extend(rows)
                event_meta.append(meta)
            except Exception as exc:
                failures.append({
                    "event_id": event.get("id"),
                    "date": event_date(event),
                    "home": (event.get("homeTeam") or {}).get("name"),
                    "away": (event.get("awayTeam") or {}).get("name"),
                    "error": str(exc),
                })
            if done % 25 == 0:
                print(f"Processed {done}/{len(events)} events; player-match rows={len(all_rows)} failures={len(failures)}")

    all_rows.sort(key=lambda r: (r["match_date"], r["team"], r["player_name"]))

    # Aggregate player baselines from the same match-level evidence used by H2H.
    by_player: dict[tuple[str, str, str], dict[str, Any]] = {}
    for row in all_rows:
        key = (row["external_player_id"], row["player_name"], row["team"])
        rec = by_player.setdefault(key, {
            "player_name": row["player_name"],
            "team": row["team"],
            "competition": COMPETITION,
            "season": SEASON_LABEL,
            "appearances": 0,
            "starts": 0,
            "minutes": 0,
            "yellow_cards": 0,
            "red_cards": 0,
            "fouls_committed": 0,
            "fouls_drawn": 0,
            "position": row.get("position") or "",
            "external_player_id": row["external_player_id"],
            "_fouls_known": 0,
            "_drawn_known": 0,
        })
        rec["appearances"] += 1
        rec["starts"] += 1 if row["starter"] else 0
        rec["minutes"] += row["minutes"] or 0
        rec["yellow_cards"] += row["yellow_card"] or 0
        rec["red_cards"] += row["red_card"] or 0
        if row["fouls_committed"] is not None:
            rec["fouls_committed"] += row["fouls_committed"]
            rec["_fouls_known"] += 1
        if row["fouls_drawn"] is not None:
            rec["fouls_drawn"] += row["fouls_drawn"]
            rec["_drawn_known"] += 1
        if not rec["position"] and row.get("position"):
            rec["position"] = row["position"]

    baselines = []
    for rec in by_player.values():
        minutes = rec["minutes"]
        p90 = minutes / 90 if minutes else 0
        fouls = rec["fouls_committed"] if rec["_fouls_known"] else None
        drawn = rec["fouls_drawn"] if rec["_drawn_known"] else None
        baselines.append({
            "player_name": rec["player_name"],
            "team": rec["team"],
            "competition": COMPETITION,
            "season": SEASON_LABEL,
            "appearances": rec["appearances"],
            "starts": rec["starts"],
            "minutes": minutes,
            "yellow_cards": rec["yellow_cards"],
            "red_cards": rec["red_cards"],
            "fouls_committed": fouls,
            "fouls_drawn": drawn,
            "fouls_per_90": round(fouls / p90, 4) if fouls is not None and p90 else None,
            "cards_per_90": round(rec["yellow_cards"] / p90, 4) if p90 else None,
            "position": rec["position"],
            "external_player_id": rec["external_player_id"],
        })
    baselines.sort(key=lambda r: (r["team"], r["player_name"]))

    # Referee tables and player-under-referee history.
    matches_by_ref = Counter(meta["referee"] for meta in event_meta if meta.get("referee"))
    ref_events = defaultdict(lambda: {"yellow": 0, "red": 0, "fouls": 0})
    player_ref = defaultdict(lambda: {"matches": 0, "yellow": 0, "red": 0, "fouls": 0, "teams": Counter(), "ref_id": ""})
    for row in all_rows:
        ref = row["_referee"]
        if not ref:
            continue
        ref_events[ref]["yellow"] += row["yellow_card"] or 0
        ref_events[ref]["red"] += row["red_card"] or 0
        ref_events[ref]["fouls"] += row["fouls_committed"] or 0
        key = (ref, row["external_player_id"], row["player_name"])
        rec = player_ref[key]
        rec["matches"] += 1
        rec["yellow"] += row["yellow_card"] or 0
        rec["red"] += row["red_card"] or 0
        rec["fouls"] += row["fouls_committed"] or 0
        rec["teams"][row["team"]] += 1
        rec["ref_id"] = row["_referee_id"] or rec["ref_id"]

    referee_rows = []
    for ref, matches in sorted(matches_by_ref.items()):
        stats = ref_events[ref]
        referee_rows.append({
            "referee_name": ref,
            "matches_refereed": matches,
            "yellow_cards": stats["yellow"],
            "red_cards": stats["red"],
            "yellows_per_game": round(stats["yellow"] / matches, 4) if matches else None,
            "fouls_per_game": round(stats["fouls"] / matches, 4) if matches else None,
            "competition": COMPETITION,
            "season": SEASON_LABEL,
            "external_referee_id": "",
        })

    player_ref_rows = []
    for (ref, player_id, player_name), rec in sorted(player_ref.items()):
        team = rec["teams"].most_common(1)[0][0] if rec["teams"] else ""
        player_ref_rows.append({
            "referee_name": ref,
            "player_name": player_name,
            "team": team,
            "competition": COMPETITION,
            "season": SEASON_LABEL,
            "matches_together": rec["matches"],
            "yellow_cards": rec["yellow"],
            "red_cards": rec["red"],
            "fouls_committed": rec["fouls"],
            "external_referee_id": rec["ref_id"],
            "external_player_id": player_id,
        })

    h2h_rows = [{k: row.get(k) for k in [
        "player_name", "team", "opponent", "match_date", "competition", "venue", "minutes",
        "fouls_committed", "fouls_drawn", "yellow_card", "red_card", "external_player_id"
    ]} for row in all_rows]

    write_csv(OUT / "player_baselines.csv", [
        "player_name", "team", "competition", "season", "appearances", "starts", "minutes",
        "yellow_cards", "red_cards", "fouls_committed", "fouls_drawn", "fouls_per_90", "cards_per_90",
        "position", "external_player_id"
    ], baselines)
    write_csv(OUT / "h2h.csv", [
        "player_name", "team", "opponent", "match_date", "competition", "venue", "minutes",
        "fouls_committed", "fouls_drawn", "yellow_card", "red_card", "external_player_id"
    ], h2h_rows)
    write_csv(OUT / "referees.csv", [
        "referee_name", "matches_refereed", "yellow_cards", "red_cards", "yellows_per_game",
        "fouls_per_game", "competition", "season", "external_referee_id"
    ], referee_rows)
    write_csv(OUT / "player_referee_history.csv", [
        "referee_name", "player_name", "team", "competition", "season", "matches_together",
        "yellow_cards", "red_cards", "fouls_committed", "external_referee_id", "external_player_id"
    ], player_ref_rows)

    report = {
        "source": "Sofascore public event API",
        "competition": COMPETITION,
        "season": SEASON_LABEL,
        "sofascore": {"unique_tournament_id": TOURNAMENT_ID, "season_id": SEASON_ID},
        "counts": {
            "regular_season_events": len(events),
            "events_processed": len(event_meta),
            "events_failed": len(failures),
            "events_with_referee": sum(1 for m in event_meta if m.get("referee")),
            "player_baselines": len(baselines),
            "h2h_player_match_rows": len(h2h_rows),
            "referees": len(referee_rows),
            "player_referee_rows": len(player_ref_rows),
            "minutes_inferred_rows": sum(m["inferred_minutes"] for m in event_meta),
        },
        "failures": failures[:100],
        "quality_rules": {
            "expected_regular_season_events": 552,
            "minimum_baselines": 450,
            "minimum_h2h_rows": 9000,
            "maximum_failed_events": 10,
        },
    }
    (OUT / "quality-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    counts = report["counts"]
    if counts["regular_season_events"] != 552:
        raise RuntimeError(f"Regular-season event count failed: {counts}")
    if counts["events_failed"] > 10:
        raise RuntimeError(f"Too many event extraction failures: {counts}")
    if counts["player_baselines"] < 450 or counts["h2h_player_match_rows"] < 9000:
        raise RuntimeError(f"Championship library is materially incomplete: {counts}")
    if counts["referees"] < 15 or counts["player_referee_rows"] < 2500:
        raise RuntimeError(f"Referee coverage is materially incomplete: {counts}")

    print(json.dumps(counts, indent=2))


if __name__ == "__main__":
    main()
