#!/usr/bin/env python3
from __future__ import annotations

import csv
import io
import json
import os
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "current-season"
CACHE = ROOT / ".cache" / "current-season-espn"
OUT.mkdir(parents=True, exist_ok=True)
CACHE.mkdir(parents=True, exist_ok=True)

SEASON_LABEL = "2026/27"
START_DATE = date(2026, 8, 1)
END_DATE = date.today()

COMPETITIONS = [
    ("eng.1", "Premier League"),
    ("eng.2", "Championship"),
]

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (compatible; footballcards-current-season/1.0)",
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-GB,en;q=0.9",
})

H2H_FIELDS = [
    "player_name", "team", "opponent", "match_date", "competition", "venue",
    "minutes", "fouls_committed", "fouls_drawn", "shots", "shots_on_target",
    "yellow_card", "red_card", "external_player_id",
]
BASELINE_FIELDS = [
    "player_name", "team", "competition", "season", "appearances", "starts",
    "minutes", "yellow_cards", "red_cards", "fouls_committed", "fouls_drawn",
    "shots", "shots_on_target", "fouls_per_90", "cards_per_90", "shots_per_90",
    "shots_on_target_per_90", "position", "external_player_id",
]


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
            r = SESSION.get(url, timeout=25)
            if r.status_code == 429:
                time.sleep(1.5 + attempt * 2)
                continue
            r.raise_for_status()
            data = r.json()
            path.write_text(json.dumps(data), encoding="utf-8")
            return data
        except Exception as exc:
            last = exc
            time.sleep(0.5 + attempt)
    raise RuntimeError(f"Failed {url}: {last}")


def stats_map(row: dict[str, Any]) -> dict[str, float]:
    out: dict[str, float] = {}
    for stat in row.get("stats") or []:
        name = stat.get("name")
        value = stat.get("value")
        if not name or value is None:
            continue
        try:
            out[str(name)] = float(value)
        except Exception:
            pass
    return out


def event_teams(event: dict[str, Any]) -> tuple[str, str]:
    competitors = ((event.get("competitions") or [{}])[0]).get("competitors") or []
    home = next((r for r in competitors if r.get("homeAway") == "home"), {})
    away = next((r for r in competitors if r.get("homeAway") == "away"), {})
    return (
        str((home.get("team") or {}).get("displayName") or ""),
        str((away.get("team") or {}).get("displayName") or ""),
    )


def event_finished(event: dict[str, Any]) -> bool:
    state = str(((event.get("status") or {}).get("type") or {}).get("state") or "").lower()
    completed = ((event.get("status") or {}).get("type") or {}).get("completed")
    name = str(((event.get("status") or {}).get("type") or {}).get("name") or "").upper()
    return completed is True or state == "post" or name in {"STATUS_FULL_TIME", "STATUS_FINAL"}


def event_date(event: dict[str, Any]) -> str:
    return str(event.get("date") or "")[:10]


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

    plays = summary.get("keyEvents") or summary.get("plays") or []
    for play in plays:
        ptype = str((play.get("type") or {}).get("type") or "").lower()
        minute = clock_minute(play)
        if minute is None:
            continue
        ids = [
            str((p.get("athlete") or {}).get("id") or "")
            for p in (play.get("participants") or [])
        ]
        ids = [x for x in ids if x]
        if ptype == "substitution" and ids:
            entered.setdefault(ids[0], minute)
            if len(ids) > 1:
                left[ids[1]] = minute
        elif ptype in {"red-card", "red_card", "second-yellow-card", "second-yellow-red-card"} and ids:
            left[ids[0]] = minute

    out: dict[str, int] = {}
    for pid in set(entered) | starters:
        start = entered.get(pid, 0 if pid in starters else 90)
        end = left.get(pid, 90)
        out[pid] = max(1, min(90, end) - max(0, min(90, start)))
    return out


def collect_events(slug: str) -> list[dict[str, Any]]:
    base = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}"
    days: list[date] = []
    d = START_DATE
    while d <= END_DATE:
        days.append(d)
        d += timedelta(days=1)

    events: dict[str, dict[str, Any]] = {}

    def load(day: date):
        key = day.strftime("%Y%m%d")
        data = cached_get(f"{base}/scoreboard?dates={key}", f"{slug}-scoreboard-{key}")
        return data.get("events") or []

    with ThreadPoolExecutor(max_workers=12) as ex:
        futures = [ex.submit(load, d) for d in days]
        for future in as_completed(futures):
            for event in future.result():
                eid = str(event.get("id") or "")
                if eid and event_finished(event):
                    events[eid] = event

    return sorted(events.values(), key=lambda e: (event_date(e), str(e.get("id") or "")))


def parse_event(slug: str, competition: str, event: dict[str, Any]) -> list[dict[str, Any]]:
    eid = str(event["id"])
    base = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}"
    summary = cached_get(f"{base}/summary?event={eid}", f"{slug}-summary-{eid}")
    home, away = event_teams(event)
    date_value = event_date(event)
    minutes_by_player = participation_minutes(summary)
    rows: list[dict[str, Any]] = []

    for section in summary.get("rosters") or []:
        side = str(section.get("homeAway") or "")
        team = str((section.get("team") or {}).get("displayName") or (home if side == "home" else away))
        opponent = away if side == "home" else home
        venue = "home" if side == "home" else "away"

        for row in section.get("roster") or []:
            athlete = row.get("athlete") or {}
            pid = str(athlete.get("id") or "")
            name = str(athlete.get("displayName") or athlete.get("fullName") or "")
            stats = stats_map(row)
            appeared = stats.get("appearances", 0) > 0 or row.get("starter") is True or row.get("subbedIn") is True
            if not pid or not name or not appeared:
                continue

            minutes = minutes_by_player.get(pid)
            if minutes is None:
                minutes = 90 if row.get("starter") is True else 1

            rows.append({
                "player_name": name,
                "team": team,
                "opponent": opponent,
                "match_date": date_value,
                "competition": competition,
                "venue": venue,
                "minutes": int(minutes),
                "fouls_committed": int(stats.get("foulsCommitted", 0)),
                "fouls_drawn": int(stats.get("foulsSuffered", 0)),
                "shots": int(stats.get("totalShots", 0)),
                "shots_on_target": int(stats.get("shotsOnTarget", 0)),
                "yellow_card": 1 if stats.get("yellowCards", 0) > 0 else 0,
                "red_card": 1 if stats.get("redCards", 0) > 0 else 0,
                "external_player_id": pid,
                "_position": str((row.get("position") or {}).get("displayName") or (row.get("position") or {}).get("abbreviation") or ""),
                "_starter": row.get("starter") is True,
            })
    return rows


def write_csv(rows: list[dict[str, Any]], fields: list[str]) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
    w.writeheader()
    w.writerows(rows)
    return buf.getvalue()


def build() -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    all_rows: list[dict[str, Any]] = []
    reports: list[dict[str, Any]] = []

    for slug, competition in COMPETITIONS:
        events = collect_events(slug)
        print(f"{competition}: {len(events)} completed matches discovered", flush=True)
        failures = []

        with ThreadPoolExecutor(max_workers=10) as ex:
            futures = {ex.submit(parse_event, slug, competition, e): e for e in events}
            for i, future in enumerate(as_completed(futures), 1):
                event = futures[future]
                try:
                    all_rows.extend(future.result())
                except Exception as exc:
                    failures.append({"event": event.get("id"), "date": event_date(event), "error": str(exc)})
                if i % 25 == 0:
                    print(f"{competition}: {i}/{len(events)} summaries; rows={len(all_rows)}", flush=True)

        reports.append({
            "competition": competition,
            "completed_matches": len(events),
            "failures": failures,
        })

    all_rows.sort(key=lambda r: (r["competition"], r["match_date"], r["team"], r["player_name"]))

    agg: dict[tuple[str, str, str, str], dict[str, Any]] = defaultdict(lambda: {
        "appearances": 0, "starts": 0, "minutes": 0, "yellow_cards": 0, "red_cards": 0,
        "fouls_committed": 0, "fouls_drawn": 0, "shots": 0, "shots_on_target": 0,
        "positions": [],
    })

    for row in all_rows:
        key = (row["competition"], row["external_player_id"], row["player_name"], row["team"])
        a = agg[key]
        a["appearances"] += 1
        a["starts"] += int(row["_starter"])
        a["minutes"] += row["minutes"]
        a["yellow_cards"] += row["yellow_card"]
        a["red_cards"] += row["red_card"]
        a["fouls_committed"] += row["fouls_committed"]
        a["fouls_drawn"] += row["fouls_drawn"]
        a["shots"] += row["shots"]
        a["shots_on_target"] += row["shots_on_target"]
        if row["_position"]:
            a["positions"].append(row["_position"])

    baselines: list[dict[str, Any]] = []
    for (competition, pid, player, team), a in agg.items():
        mins = a["minutes"]
        p90 = lambda n: round(n / mins * 90, 4) if mins else 0
        position = Counter(a["positions"]).most_common(1)[0][0] if a["positions"] else ""
        baselines.append({
            "player_name": player,
            "team": team,
            "competition": competition,
            "season": SEASON_LABEL,
            "appearances": a["appearances"],
            "starts": a["starts"],
            "minutes": mins,
            "yellow_cards": a["yellow_cards"],
            "red_cards": a["red_cards"],
            "fouls_committed": a["fouls_committed"],
            "fouls_drawn": a["fouls_drawn"],
            "shots": a["shots"],
            "shots_on_target": a["shots_on_target"],
            "fouls_per_90": p90(a["fouls_committed"]),
            "cards_per_90": p90(a["yellow_cards"] + a["red_cards"]),
            "shots_per_90": p90(a["shots"]),
            "shots_on_target_per_90": p90(a["shots_on_target"]),
            "position": position,
            "external_player_id": pid,
        })
    baselines.sort(key=lambda r: (r["competition"], r["team"], r["player_name"]))

    clean_rows = [{k: row[k] for k in H2H_FIELDS} for row in all_rows]
    return clean_rows, baselines, reports


def sync(dataset: str, content: str) -> dict[str, Any]:
    base = os.environ.get("SYNC_URL", "").rstrip("/")
    if not base:
        return {"skipped": True}
    r = requests.post(
        f"{base}/api/admin/import",
        json={"dataset": dataset, "format": "csv", "content": content, "replaceCurrentSeason": True},
        timeout=180,
    )
    print(f"Neon {dataset}: {r.status_code} {r.text[:600]}", flush=True)
    r.raise_for_status()
    return r.json()


def main() -> int:
    h2h, baselines, reports = build()
    if not h2h or not baselines:
        raise RuntimeError("No current-season data produced")

    h2h_csv = write_csv(h2h, H2H_FIELDS)
    baseline_csv = write_csv(baselines, BASELINE_FIELDS)
    (OUT / "h2h.csv").write_text(h2h_csv, encoding="utf-8")
    (OUT / "player_baselines.csv").write_text(baseline_csv, encoding="utf-8")

    totals = {
        "player_match_rows": len(h2h),
        "player_baselines": len(baselines),
        "shots": sum(int(r["shots"]) for r in h2h),
        "shots_on_target": sum(int(r["shots_on_target"]) for r in h2h),
        "yellows": sum(int(r["yellow_card"]) for r in h2h),
        "fouls_committed": sum(int(r["fouls_committed"]) for r in h2h),
        "fouls_drawn": sum(int(r["fouls_drawn"]) for r in h2h),
    }

    quality = {
        "source": "ESPN public match-summary player statistics",
        "season": SEASON_LABEL,
        "from": START_DATE.isoformat(),
        "to": END_DATE.isoformat(),
        "competitions": reports,
        "totals": totals,
    }

    if os.environ.get("SYNC_URL"):
        quality["neon_sync"] = {
            "h2h": sync("h2h", h2h_csv),
            "player_baselines": sync("player_baselines", baseline_csv),
        }

    (OUT / "quality-report.json").write_text(json.dumps(quality, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(quality, indent=2), flush=True)

    if totals["player_match_rows"] < 500 or totals["shots_on_target"] <= 0 or totals["fouls_committed"] <= 0 or totals["yellows"] <= 0:
        raise RuntimeError(f"Quality gate failed: {totals}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
