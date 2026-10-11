#!/usr/bin/env python3
from __future__ import annotations

import csv
import io
import json
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

# soccerdata reads custom league config at import time.
ROOT = Path(__file__).resolve().parents[1]
SOCCERDATA_DIR = Path(os.environ.get("SOCCERDATA_DIR", ROOT / ".cache" / "soccerdata"))
os.environ["SOCCERDATA_DIR"] = str(SOCCERDATA_DIR)
CONFIG_DIR = SOCCERDATA_DIR / "config"
CONFIG_DIR.mkdir(parents=True, exist_ok=True)
(CONFIG_DIR / "league_dict.json").write_text(
    json.dumps(
        {
            "ENG-Championship": {
                "FBref": "Championship",
                "ESPN": "eng.2",
                "Sofascore": "Championship",
                "WhoScored": "England - Championship",
                "MatchHistory": "E1",
                "season_start": "Aug",
                "season_end": "May",
            }
        },
        indent=2,
    ),
    encoding="utf-8",
)

import pandas as pd  # noqa: E402
import requests  # noqa: E402
import soccerdata as sd  # noqa: E402

OUT = ROOT / "data" / "current-season"
OUT.mkdir(parents=True, exist_ok=True)
SEASON_LABEL = "2026/27"
SEASON_SELECTOR = "2026-2027"

LEAGUES = [
    ("ENG-Premier League", "Premier League"),
    ("ENG-Championship", "Championship"),
]

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


def norm(value: Any) -> str:
    return (
        str(value or "")
        .casefold()
        .replace("’", "'")
        .replace("–", "-")
        .replace("—", "-")
        .strip()
    )


def flatten_columns(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    cols = []
    for col in out.columns:
        if isinstance(col, tuple):
            values = [str(v).strip() for v in col if str(v).strip() and not str(v).startswith("Unnamed")]
            cols.append(values[-1] if values else "")
        else:
            cols.append(str(col).strip())
    out.columns = cols
    return out


def first_col(row: pd.Series, *names: str, default: Any = None) -> Any:
    lower = {str(k).casefold(): k for k in row.index}
    for name in names:
        key = lower.get(name.casefold())
        if key is not None:
            value = row[key]
            if not pd.isna(value):
                return value
    return default


def as_int(value: Any) -> int:
    if value is None or pd.isna(value):
        return 0
    try:
        return int(float(value))
    except Exception:
        return 0


def bool_csv(value: bool) -> str:
    return "true" if value else "false"


def write_csv(path: Path, rows: list[dict[str, Any]], fields: list[str]) -> str:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    text = buffer.getvalue()
    path.write_text(text, encoding="utf-8")
    return text


def matchup(team: str, home: str, away: str) -> tuple[str, str]:
    nt, nh, na = norm(team), norm(home), norm(away)
    if nt == nh or nt in nh or nh in nt:
        return away, "home"
    if nt == na or nt in na or na in nt:
        return home, "away"
    return "", ""


def build_league(source_key: str, competition: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    print(f"\n=== Scraping {competition} {SEASON_LABEL} from FBref ===", flush=True)
    chrome_path = os.environ.get("CHROME_PATH")
    fb = sd.FBref(
        leagues=source_key,
        seasons=SEASON_SELECTOR,
        no_cache=True,
        path_to_browser=Path(chrome_path) if chrome_path else None,
        headless=True,
    )

    schedule = flatten_columns(fb.read_schedule(force_cache=False).reset_index())
    completed = schedule[schedule.get("game_id").notna()].copy()
    print(f"{competition}: {len(completed)} completed match reports found", flush=True)

    summary = flatten_columns(fb.read_player_match_stats(stat_type="summary", force_cache=False).reset_index())
    try:
        lineup = flatten_columns(fb.read_lineup(force_cache=True).reset_index())
    except Exception as exc:
        print(f"{competition}: lineup parse warning: {exc}", file=sys.stderr)
        lineup = pd.DataFrame()

    schedule_by_game: dict[str, dict[str, Any]] = {}
    for _, row in completed.iterrows():
        game = str(first_col(row, "game", default=""))
        schedule_by_game[game] = {
            "date": pd.to_datetime(first_col(row, "date")).date().isoformat(),
            "home": str(first_col(row, "home_team", "Home", default="")),
            "away": str(first_col(row, "away_team", "Away", default="")),
        }

    starter_keys: set[tuple[str, str, str]] = set()
    if not lineup.empty:
        for _, row in lineup.iterrows():
            if bool(first_col(row, "is_starter", default=False)):
                starter_keys.add(
                    (
                        str(first_col(row, "game", default="")),
                        norm(first_col(row, "team", default="")),
                        norm(first_col(row, "player", default="")),
                    )
                )

    h2h_rows: list[dict[str, Any]] = []
    aggregate: dict[tuple[str, str], dict[str, Any]] = defaultdict(
        lambda: {
            "appearances": 0, "starts": 0, "minutes": 0, "yellow_cards": 0,
            "red_cards": 0, "fouls_committed": 0, "fouls_drawn": 0,
            "shots": 0, "shots_on_target": 0, "positions": [],
        }
    )

    for _, row in summary.iterrows():
        player = str(first_col(row, "player", "Player", default="")).strip()
        team = str(first_col(row, "team", default="")).strip()
        game = str(first_col(row, "game", default=""))
        if not player or not team or game not in schedule_by_game:
            continue

        meta = schedule_by_game[game]
        opponent, venue = matchup(team, meta["home"], meta["away"])
        if not opponent:
            continue

        minutes = as_int(first_col(row, "min", "Min"))
        shots = as_int(first_col(row, "Sh", "shots"))
        sot = as_int(first_col(row, "SoT", "shots_on_target"))
        fls = as_int(first_col(row, "Fls", "fouls"))
        fld = as_int(first_col(row, "Fld", "fouled"))
        yellow = as_int(first_col(row, "CrdY", "yellow_cards")) > 0
        red = as_int(first_col(row, "CrdR", "red_cards")) > 0
        position = str(first_col(row, "pos", "Pos", default="")).strip()

        h2h_rows.append(
            {
                "player_name": player,
                "team": team,
                "opponent": opponent,
                "match_date": meta["date"],
                "competition": competition,
                "venue": venue,
                "minutes": minutes,
                "fouls_committed": fls,
                "fouls_drawn": fld,
                "shots": shots,
                "shots_on_target": sot,
                "yellow_card": bool_csv(yellow),
                "red_card": bool_csv(red),
                "external_player_id": "",
            }
        )

        if minutes > 0:
            key = (player, team)
            a = aggregate[key]
            a["appearances"] += 1
            if (game, norm(team), norm(player)) in starter_keys:
                a["starts"] += 1
            a["minutes"] += minutes
            a["yellow_cards"] += int(yellow)
            a["red_cards"] += int(red)
            a["fouls_committed"] += fls
            a["fouls_drawn"] += fld
            a["shots"] += shots
            a["shots_on_target"] += sot
            if position:
                a["positions"].append(position)

    baselines: list[dict[str, Any]] = []
    for (player, team), a in aggregate.items():
        mins = a["minutes"]
        per90 = lambda n: round(n / mins * 90, 4) if mins else 0
        position = Counter(a["positions"]).most_common(1)[0][0] if a["positions"] else ""
        baselines.append(
            {
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
                "fouls_per_90": per90(a["fouls_committed"]),
                "cards_per_90": per90(a["yellow_cards"] + a["red_cards"]),
                "shots_per_90": per90(a["shots"]),
                "shots_on_target_per_90": per90(a["shots_on_target"]),
                "position": position,
                "external_player_id": "",
            }
        )

    report = {
        "competition": competition,
        "completed_matches": len(completed),
        "player_match_rows": len(h2h_rows),
        "player_baselines": len(baselines),
        "players_with_sot": sum(1 for r in baselines if int(r["shots_on_target"]) > 0),
        "total_sot": sum(int(r["shots_on_target"]) for r in baselines),
        "total_yellows": sum(int(r["yellow_cards"]) for r in baselines),
        "total_fouls": sum(int(r["fouls_committed"]) for r in baselines),
    }
    print(json.dumps(report, indent=2), flush=True)
    return h2h_rows, baselines, report


def sync_to_neon(h2h_csv: str, baseline_csv: str) -> dict[str, Any] | None:
    base = os.environ.get("SYNC_URL", "").rstrip("/")
    if not base:
        return None
    result: dict[str, Any] = {}
    for dataset, content in [("h2h", h2h_csv), ("player_baselines", baseline_csv)]:
        response = requests.post(
            f"{base}/api/admin/import",
            json={
                "dataset": dataset,
                "format": "csv",
                "content": content,
                "replaceCurrentSeason": True,
            },
            timeout=120,
        )
        print(f"Neon sync {dataset}: {response.status_code} {response.text[:500]}", flush=True)
        response.raise_for_status()
        result[dataset] = response.json()
    return result


def main() -> int:
    all_h2h: list[dict[str, Any]] = []
    all_baselines: list[dict[str, Any]] = []
    reports: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []

    for source_key, competition in LEAGUES:
        try:
            h2h, baselines, report = build_league(source_key, competition)
            all_h2h.extend(h2h)
            all_baselines.extend(baselines)
            reports.append(report)
        except Exception as exc:
            failures.append({"competition": competition, "error": str(exc)})
            print(f"FAILED {competition}: {exc}", file=sys.stderr, flush=True)

    if not all_h2h or not all_baselines:
        raise RuntimeError(f"No usable current-season data produced. Failures: {failures}")

    h2h_csv = write_csv(OUT / "h2h.csv", all_h2h, H2H_FIELDS)
    baseline_csv = write_csv(OUT / "player_baselines.csv", all_baselines, BASELINE_FIELDS)

    quality = {
        "season": SEASON_LABEL,
        "source": "FBref via soccerdata",
        "competitions": reports,
        "failures": failures,
        "totals": {
            "player_match_rows": len(all_h2h),
            "player_baselines": len(all_baselines),
            "shots": sum(int(r["shots"]) for r in all_baselines),
            "shots_on_target": sum(int(r["shots_on_target"]) for r in all_baselines),
            "yellows": sum(int(r["yellow_cards"]) for r in all_baselines),
            "fouls_committed": sum(int(r["fouls_committed"]) for r in all_baselines),
            "fouls_drawn": sum(int(r["fouls_drawn"]) for r in all_baselines),
        },
    }

    sync = sync_to_neon(h2h_csv, baseline_csv)
    if sync is not None:
        quality["neon_sync"] = sync

    (OUT / "quality-report.json").write_text(json.dumps(quality, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(quality, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
