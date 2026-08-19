"""Regular-season Championship builder wrapper.

The base scraper deliberately keeps its extraction logic in one file. This
wrapper narrows competition c10 to the 46-match Championship league season,
excluding promotion play-off rows so match logs reconcile with FBref's league
season aggregate tables.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

BASE_SCRIPT = Path(__file__).with_name("build-championship-library.py")
spec = importlib.util.spec_from_file_location("championship_builder", BASE_SCRIPT)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Could not load {BASE_SCRIPT}")

builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def parse_regular_schedule():
    html = builder.fetch(builder.SCHEDULE_URL, "schedule.html")
    table = builder.find_table(
        html,
        required_stats={"date", "home_team", "away_team", "referee", "round"},
        preferred_ids=(f"sched_{builder.SEASON}_{builder.COMP_ID}_1",),
    )

    matches = []
    lookup = {}
    for row in table.select("tbody tr"):
        # FBref labels the 46-match league phase as Championship and the extra
        # knockout games as Promotion play-offs — ... .
        if builder.cell_text(row, "round") != "Championship":
            continue

        date = builder.cell_text(row, "date")
        home = builder.clean_team(builder.cell_text(row, "home_team"))
        away = builder.clean_team(builder.cell_text(row, "away_team"))
        referee = builder.cell_text(row, "referee")
        if not date or not home or not away or not referee:
            continue

        record = {"date": date, "home": home, "away": away, "referee": referee}
        matches.append(record)
        lookup[(date, home.casefold(), away.casefold())] = referee
        lookup[(date, frozenset((home.casefold(), away.casefold())))] = referee

    # 24 teams x 46 matches / 2 = 552 regular-season fixtures.
    if len(matches) != 552:
        raise RuntimeError(f"Expected 552 regular Championship matches with referees, found {len(matches)}")
    return matches, lookup


def parse_regular_player_matchlogs(players, schedule_lookup):
    rows, failures, missing = builder.parse_player_matchlogs(players, schedule_lookup)

    # The base player pages under competition c10 also expose promotion play-off
    # appearances. Only rows that map to the 552-match regular schedule belong
    # in this 2025/26 league baseline/H2H library.
    regular_rows = [row for row in rows if row.get("_referee")]

    real_missing = []
    for row in missing:
        team = builder.clean_team(row["team"]).casefold()
        opponent = builder.clean_team(row["opponent"]).casefold()
        key = (row["date"], frozenset((team, opponent)))
        if key in schedule_lookup:
            real_missing.append(row)

    return regular_rows, failures, real_missing


builder.parse_schedule = parse_regular_schedule
builder.parse_player_matchlogs = parse_regular_player_matchlogs
builder.main()
