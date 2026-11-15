#!/usr/bin/env python3
from __future__ import annotations

import csv
import io
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path
from typing import Any

import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "h2h-history"
CACHE = ROOT / ".cache" / "h2h-history"
OUT.mkdir(parents=True, exist_ok=True)
CACHE.mkdir(parents=True, exist_ok=True)

TODAY = date.today()
DOMESTIC_START = date(2025, 7, 1)
INTERNATIONAL_START = date(2024, 6, 1)

DOMESTIC = [
    ("eng.1", "Premier League"),
    ("eng.2", "Championship"),
    ("eng.3", "League One"),
    ("eng.4", "League Two"),
    ("eng.fa", "FA Cup"),
    ("eng.league_cup", "League Cup"),
]
INTERNATIONAL = [
    ("uefa.euro", "UEFA European Championship"),
    ("uefa.nations", "UEFA Nations League"),
    ("fifa.worldq.uefa", "FIFA World Cup Qualifying - UEFA"),
    ("fifa.world", "FIFA World Cup"),
    ("fifa.friendly", "International Friendly"),
]

FIELDS = [
    "player_name","team","opponent","match_date","competition","venue",
    "minutes","goals","assists","fouls_committed","fouls_drawn","shots",
    "shots_on_target","yellow_card","red_card","external_player_id",
]

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (compatible; footballcards-h2h-history/1.0)",
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-GB,en;q=0.9",
})

def cached_get(url: str, cache_key: str, attempts: int = 4) -> dict[str, Any]:
    path = CACHE / f"{cache_key}.json"
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            path.unlink(missing_ok=True)
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            r = SESSION.get(url, timeout=30)
            if r.status_code == 429:
                time.sleep(2 + attempt * 3)
                continue
            r.raise_for_status()
            data = r.json()
            path.write_text(json.dumps(data), encoding="utf-8")
            return data
        except Exception as exc:
            last = exc
            time.sleep(0.8 + attempt)
    raise RuntimeError(f"Failed {url}: {last}")

def month_keys(start: date, end: date) -> list[str]:
    out = []
    y, m = start.year, start.month
    while y < end.year or (y == end.year and m <= end.month):
        out.append(f"{y}{m:02d}")
        m += 1
        if m > 12:
            m = 1
            y += 1
    return out

def event_date(event: dict[str, Any]) -> str:
    return str(event.get("date") or "")[:10]

def event_finished(event: dict[str, Any]) -> bool:
    status = (event.get("status") or {}).get("type") or {}
    state = str(status.get("state") or "").lower()
    name = str(status.get("name") or "").upper()
    return status.get("completed") is True or state == "post" or name in {"STATUS_FINAL","STATUS_FULL_TIME"}

def event_teams(event: dict[str, Any]) -> tuple[str, str]:
    rows = ((event.get("competitions") or [{}])[0]).get("competitors") or []
    home = next((x for x in rows if x.get("homeAway") == "home"), {})
    away = next((x for x in rows if x.get("homeAway") == "away"), {})
    return str((home.get("team") or {}).get("displayName") or ""), str((away.get("team") or {}).get("displayName") or "")

def stat_map(row: dict[str, Any]) -> dict[str, float]:
    out: dict[str, float] = {}
    for item in row.get("stats") or []:
        name, value = item.get("name"), item.get("value")
        if not name or value is None:
            continue
        try:
            out[str(name)] = float(value)
        except Exception:
            pass
    return out

def clock_minute(play: dict[str, Any]) -> int | None:
    clock = play.get("clock") or {}
    value = clock.get("value")
    try:
        return max(0, min(120, int(float(value) // 60)))
    except Exception:
        text = str(clock.get("displayValue") or "").replace("+", " ").replace("'", " ")
        try:
            return max(0, min(120, int(text.split()[0])))
        except Exception:
            return None

def participation_minutes(summary: dict[str, Any]) -> dict[str, int]:
    entered: dict[str, int] = {}
    left: dict[str, int] = {}
    starters: set[str] = set()
    for section in summary.get("rosters") or []:
        for row in section.get("roster") or []:
            pid = str((row.get("athlete") or {}).get("id") or "")
            if not pid:
                continue
            if row.get("starter") is True:
                starters.add(pid)
                entered[pid] = 0
    for play in summary.get("keyEvents") or summary.get("plays") or []:
        ptype = str((play.get("type") or {}).get("type") or "").lower()
        minute = clock_minute(play)
        if minute is None:
            continue
        ids = [str((p.get("athlete") or {}).get("id") or "") for p in play.get("participants") or []]
        ids = [x for x in ids if x]
        if ptype == "substitution" and ids:
            entered.setdefault(ids[0], minute)
            if len(ids) > 1:
                left[ids[1]] = minute
        elif ptype in {"red-card","red_card","second-yellow-card","second-yellow-red-card"} and ids:
            left[ids[0]] = minute
    out: dict[str, int] = {}
    for pid in set(entered) | starters:
        start = entered.get(pid, 0 if pid in starters else 90)
        end = left.get(pid, 90)
        out[pid] = max(1, min(90, end) - max(0, min(90, start)))
    return out

def collect_events(slug: str, start: date, *, england_only: bool = False) -> list[dict[str, Any]]:
    base = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}"
    events: dict[str, dict[str, Any]] = {}
    for key in month_keys(start, TODAY):
        try:
            data = cached_get(f"{base}/scoreboard?dates={key}&limit=500", f"{slug}-scoreboard-{key}")
        except Exception as exc:
            print(f"{slug} {key}: scoreboard failed: {exc}", flush=True)
            continue
        for event in data.get("events") or []:
            eid = str(event.get("id") or "")
            played = event_date(event)
            if not eid or not event_finished(event) or not (start.isoformat() <= played <= TODAY.isoformat()):
                continue
            if england_only:
                home, away = event_teams(event)
                if "england" not in {home.casefold(), away.casefold()}:
                    continue
            events[eid] = event
    return sorted(events.values(), key=lambda e: (event_date(e), str(e.get("id") or "")))

def parse_event(slug: str, competition: str, event: dict[str, Any]) -> list[dict[str, Any]]:
    eid = str(event["id"])
    base = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}"
    summary = cached_get(f"{base}/summary?event={eid}", f"{slug}-summary-{eid}")
    home, away = event_teams(event)
    played = event_date(event)
    minutes = participation_minutes(summary)
    rows: list[dict[str, Any]] = []
    for section in summary.get("rosters") or []:
        side = str(section.get("homeAway") or "")
        team = str((section.get("team") or {}).get("displayName") or (home if side == "home" else away))
        opponent = away if side == "home" else home
        venue = "home" if side == "home" else "away"
        for row in section.get("roster") or []:
            athlete = row.get("athlete") or {}
            pid = str(athlete.get("id") or "")
            name = str(athlete.get("displayName") or athlete.get("fullName") or "").strip()
            if not pid or not name:
                continue
            stats = stat_map(row)
            appeared = stats.get("appearances", 0) > 0 or row.get("starter") is True or row.get("subbedIn") is True
            if not appeared:
                # Some ESPN historical summaries omit appearances but still expose match stats.
                appeared = any(stats.get(k, 0) > 0 for k in ("totalGoals","goalAssists","foulsCommitted","foulsSuffered","totalShots","shotsOnTarget","yellowCards","redCards"))
            if not appeared:
                continue
            mins = minutes.get(pid)
            if mins is None:
                mins = 90 if row.get("starter") is True else 1
            rows.append({
                "player_name": name,
                "team": team,
                "opponent": opponent,
                "match_date": played,
                "competition": competition,
                "venue": venue,
                "minutes": int(mins),
                "goals": int(stats.get("totalGoals", 0)),
                "assists": int(stats.get("goalAssists", 0)),
                "fouls_committed": int(stats.get("foulsCommitted", 0)),
                "fouls_drawn": int(stats.get("foulsSuffered", 0)),
                "shots": int(stats.get("totalShots", 0)),
                "shots_on_target": int(stats.get("shotsOnTarget", 0)),
                "yellow_card": 1 if stats.get("yellowCards", 0) > 0 else 0,
                "red_card": 1 if stats.get("redCards", 0) > 0 else 0,
                "external_player_id": pid,
            })
    return rows

def collect_competition(slug: str, label: str, start: date, *, england_only: bool = False) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    events = collect_events(slug, start, england_only=england_only)
    print(f"{label}: {len(events)} completed matches discovered", flush=True)
    rows: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = {ex.submit(parse_event, slug, label, event): event for event in events}
        for i, future in enumerate(as_completed(futures), 1):
            event = futures[future]
            try:
                rows.extend(future.result())
            except Exception as exc:
                failures.append({"event": str(event.get("id") or ""), "date": event_date(event), "error": str(exc)})
            if i % 40 == 0:
                print(f"{label}: {i}/{len(events)} summaries; rows={len(rows)}", flush=True)
    return rows, {"competition": label, "matches": len(events), "rows": len(rows), "failures": failures}

def write_csv(rows: list[dict[str, Any]]) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=FIELDS, extrasaction="ignore", lineterminator="\n")
    w.writeheader()
    w.writerows(rows)
    return buf.getvalue()

def sync(rows: list[dict[str, Any]]) -> dict[str, Any]:
    base = os.environ.get("SYNC_URL", "").rstrip("/")
    if not base:
        return {"skipped": True, "rows": 0}
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[str(row.get("competition") or "Unknown")].append(row)
    result: dict[str, Any] = {"rows": 0, "competitions": {}}
    for competition, competition_rows in grouped.items():
        done = 0
        for offset in range(0, len(competition_rows), 700):
            chunk = competition_rows[offset:offset + 700]
            response = requests.post(
                f"{base}/api/admin/import",
                json={"dataset": "h2h", "format": "csv", "content": write_csv(chunk), "replaceCurrentSeason": False},
                timeout=180,
            )
            print(f"Sync {competition} chunk {offset//700+1}: {response.status_code} {response.text[:300]}", flush=True)
            response.raise_for_status()
            done += len(chunk)
        result["competitions"][competition] = done
        result["rows"] += done
    return result

def main() -> int:
    all_rows: list[dict[str, Any]] = []
    reports: list[dict[str, Any]] = []

    for slug, label in DOMESTIC:
        rows, report = collect_competition(slug, label, DOMESTIC_START)
        all_rows.extend(rows)
        reports.append(report)

    # The user specifically wants England's recent tournament cycle in the preloaded database.
    # Other international H2H can still be fetched on demand by /api/team-h2h.
    for slug, label in INTERNATIONAL:
        rows, report = collect_competition(slug, label, INTERNATIONAL_START, england_only=True)
        all_rows.extend(rows)
        reports.append(report)

    # Exact duplicate rows can occur when ESPN mirrors one cup match in more than one feed.
    unique: dict[tuple[str, str, str, str, str], dict[str, Any]] = {}
    for row in all_rows:
        key = (
            str(row["player_name"]),
            str(row["team"]),
            str(row["opponent"]),
            str(row["match_date"]),
            str(row["competition"]),
        )
        unique[key] = row
    rows = sorted(unique.values(), key=lambda r: (r["match_date"], r["competition"], r["team"], r["player_name"]))

    csv_text = write_csv(rows)
    (OUT / "player_h2h_2025_26_2026_27_plus_england.csv").write_text(csv_text, encoding="utf-8")
    report = {
        "generatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "domesticScope": "2025/26 + 2026/27 to date, Premier League/Championship/League One/League Two + FA Cup + League Cup",
        "internationalScope": "England from Euro 2024 onward: Euro 2024, Nations League, 2026 World Cup qualifying, 2026 World Cup, relevant friendlies",
        "rows": len(rows),
        "yellowCards": sum(int(r["yellow_card"]) for r in rows),
        "goals": sum(int(r["goals"]) for r in rows),
        "fouls": sum(int(r["fouls_committed"]) for r in rows),
        "shots": sum(int(r["shots"]) for r in rows),
        "shotsOnTarget": sum(int(r["shots_on_target"]) for r in rows),
        "competitions": reports,
    }
    report["neonSync"] = sync(rows)
    (OUT / "quality-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    if len(rows) < 1000:
        raise RuntimeError(f"History backfill produced too few rows: {len(rows)}")
    if report["fouls"] <= 0 or report["shotsOnTarget"] <= 0 or report["yellowCards"] <= 0:
        raise RuntimeError(f"Critical player stats missing: {report}")

    print(json.dumps(report, indent=2), flush=True)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
