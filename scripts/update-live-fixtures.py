from __future__ import annotations

import json
import os
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

import requests

DIRECT_HOSTS = [
    "https://www.sofascore.com/api/v1",
    "https://api.sofascore.com/api/v1",
]
TARGET_TOURNAMENTS = {17: "Premier League", 18: "Championship"}
OUT = Path(os.environ.get("LIVE_FIXTURE_OUTPUT", "/tmp/live-fixtures.json"))

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (compatible; footballcards-live/1.1)",
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-GB,en;q=0.9",
    "Referer": "https://www.sofascore.com/",
})


def parse_json_text(text: str) -> dict[str, Any] | None:
    text = text.strip()
    try:
        value = json.loads(text)
        return value if isinstance(value, dict) else None
    except Exception:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        try:
            value = json.loads(text[start : end + 1])
            return value if isinstance(value, dict) else None
        except Exception:
            return None
    return None


def candidate_urls(path: str) -> list[str]:
    direct = [f"{host}{path}" for host in DIRECT_HOSTS]
    target = direct[0]
    return [
        *direct,
        f"https://api.allorigins.win/raw?url={quote(target, safe='')}",
        f"https://r.jina.ai/{target}",
    ]


def fetch_json(path: str, *, optional: bool = False) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    attempts = []
    for url in candidate_urls(path):
        try:
            response = SESSION.get(url, timeout=18)
            text = response.text
            parsed = parse_json_text(text) if response.ok else None
            attempts.append({"url": url, "status": response.status_code, "parsed": bool(parsed)})
            if response.ok and parsed is not None:
                return parsed, {"ok": True, "url": url, "status": response.status_code, "attempts": attempts}
        except Exception as exc:
            attempts.append({"url": url, "status": None, "parsed": False, "error": str(exc)[:180]})
        time.sleep(0.15)
    if optional:
        return None, {"ok": False, "attempts": attempts}
    raise RuntimeError(f"All SofaScore providers failed for {path}: {attempts}")


def event_date(event: dict[str, Any]) -> str:
    ts = event.get("startTimestamp")
    if not ts:
        return ""
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%Y-%m-%d")


def tournament_info(event: dict[str, Any]) -> tuple[int | None, str]:
    tournament = event.get("tournament") or {}
    unique = tournament.get("uniqueTournament") or {}
    tournament_id = unique.get("id")
    try:
        tournament_id = int(tournament_id) if tournament_id is not None else None
    except Exception:
        tournament_id = None
    return tournament_id, str(unique.get("name") or tournament.get("name") or "")


def compact_player(player: dict[str, Any], position: Any = None) -> dict[str, Any] | None:
    if not player.get("name"):
        return None
    return {
        "id": player.get("id"),
        "name": player.get("name"),
        "shortName": player.get("shortName"),
        "position": player.get("position") or position,
    }


def lineup_side(data: dict[str, Any] | None, side: str) -> list[dict[str, Any]]:
    if not data:
        return []
    entries = ((data.get(side) or {}).get("players") or [])
    starters = []
    for row in entries:
        if row.get("substitute") is not False:
            continue
        compact = compact_player(row.get("player") or {}, row.get("position"))
        if compact:
            starters.append(compact)
    return starters


def roster_players(data: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not data:
        return []
    rows = []
    seen = set()
    for entry in data.get("players") or []:
        player = entry.get("player") if isinstance(entry, dict) else None
        if not isinstance(player, dict):
            continue
        compact = compact_player(player, entry.get("position"))
        if not compact:
            continue
        key = compact.get("id") or compact.get("name")
        if key in seen:
            continue
        seen.add(key)
        rows.append(compact)
    return rows


def referee_from(event: dict[str, Any], detail: dict[str, Any] | None) -> dict[str, Any] | None:
    candidates = [
        event.get("referee"),
        (detail or {}).get("referee"),
        ((detail or {}).get("event") or {}).get("referee"),
    ]
    for ref in candidates:
        if isinstance(ref, dict) and ref.get("name"):
            return {"id": ref.get("id"), "name": ref.get("name")}
    return None


def main() -> int:
    today = date.today()
    dates = [today + timedelta(days=i) for i in range(0, 10)]
    events_by_id: dict[int, dict[str, Any]] = {}
    provider_attempts = []

    for day in dates:
        path = f"/sport/football/scheduled-events/{day.isoformat()}"
        data, meta = fetch_json(path, optional=True)
        provider_attempts.append({"date": day.isoformat(), **meta})
        if not data:
            continue
        for event in data.get("events") or []:
            tournament_id, _ = tournament_info(event)
            if tournament_id not in TARGET_TOURNAMENTS:
                continue
            event_id = event.get("id")
            if event_id:
                events_by_id[int(event_id)] = event

    if not events_by_id:
        current_seasons = {17: 96668, 18: 97037}
        for tournament_id, season_id in current_seasons.items():
            for round_no in range(1, 5):
                data, meta = fetch_json(
                    f"/unique-tournament/{tournament_id}/season/{season_id}/events/round/{round_no}",
                    optional=True,
                )
                provider_attempts.append({"tournament": tournament_id, "round": round_no, **meta})
                if not data:
                    continue
                for event in data.get("events") or []:
                    d = event_date(event)
                    if d and today.isoformat() <= d <= (today + timedelta(days=9)).isoformat() and event.get("id"):
                        events_by_id[int(event["id"])] = event

    team_ids = set()
    for event in events_by_id.values():
        for side in ("homeTeam", "awayTeam"):
            team_id = (event.get(side) or {}).get("id")
            if team_id:
                team_ids.add(int(team_id))

    rosters: dict[int, list[dict[str, Any]]] = {}
    roster_health: dict[int, dict[str, Any]] = {}
    for team_id in sorted(team_ids):
        data, meta = fetch_json(f"/team/{team_id}/players", optional=True)
        rosters[team_id] = roster_players(data)
        roster_health[team_id] = {"ok": meta.get("ok", False), "players": len(rosters[team_id])}

    output_events = []
    event_provider_ok = 0
    for event in sorted(events_by_id.values(), key=lambda e: (e.get("startTimestamp") or 0, e.get("id") or 0)):
        event_id = int(event["id"])
        tournament_id, tournament_name = tournament_info(event)
        lineups, lineup_meta = fetch_json(f"/event/{event_id}/lineups", optional=True)
        detail, detail_meta = fetch_json(f"/event/{event_id}", optional=True)
        if lineup_meta.get("ok") or detail_meta.get("ok"):
            event_provider_ok += 1
        home_starters = lineup_side(lineups, "home")
        away_starters = lineup_side(lineups, "away")
        home_team = event.get("homeTeam") or {}
        away_team = event.get("awayTeam") or {}
        home_id = int(home_team["id"]) if home_team.get("id") else None
        away_id = int(away_team["id"]) if away_team.get("id") else None
        output_events.append({
            "eventId": event_id,
            "competition": TARGET_TOURNAMENTS.get(tournament_id, tournament_name),
            "date": event_date(event),
            "startTimestamp": event.get("startTimestamp"),
            "home": {"id": home_id, "name": home_team.get("name")},
            "away": {"id": away_id, "name": away_team.get("name")},
            "referee": referee_from(event, detail),
            "lineupsConfirmed": len(home_starters) >= 11 and len(away_starters) >= 11,
            "homeStarters": home_starters,
            "awayStarters": away_starters,
            "homeRoster": rosters.get(home_id or -1, []),
            "awayRoster": rosters.get(away_id or -1, []),
        })

    provider_ok = bool(events_by_id)
    payload = {
        "provider": "SofaScore with proxy fallbacks",
        "providerOk": provider_ok,
        "range": {"from": today.isoformat(), "to": (today + timedelta(days=9)).isoformat()},
        "competitions": ["Premier League", "Championship"],
        "events": output_events,
        "health": {
            "eventsDiscovered": len(events_by_id),
            "eventsWithDetailOrLineupProvider": event_provider_ok,
            "rosters": roster_health,
            "discoveryAttempts": provider_attempts,
        },
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"providerOk": provider_ok, "events": len(output_events), "teams": len(team_ids), "output": str(OUT)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
