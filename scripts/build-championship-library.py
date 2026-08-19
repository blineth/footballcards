from __future__ import annotations

import csv
import json
import re
import time
from collections import Counter, defaultdict
from pathlib import Path

import requests
from bs4 import BeautifulSoup, Comment

BASE = "https://fbref.com"
SEASON = "2025-2026"
SEASON_LABEL = "2025/26"
COMPETITION = "Championship"
COMP_ID = "10"
OUT = Path("data/championship")
CACHE = Path(".cache/championship-fbref")
OUT.mkdir(parents=True, exist_ok=True)
CACHE.mkdir(parents=True, exist_ok=True)

STANDARD_URL = f"{BASE}/en/comps/{COMP_ID}/{SEASON}/stats/{SEASON}-Championship-Stats"
MISC_URL = f"{BASE}/en/comps/{COMP_ID}/{SEASON}/misc/{SEASON}-Championship-Stats"
SCHEDULE_URL = f"{BASE}/en/comps/{COMP_ID}/{SEASON}/schedule/{SEASON}-Championship-Scores-and-Fixtures"

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "footballcards-research/1.0 (historical football research; contact via repository)",
    "Accept-Language": "en-GB,en;q=0.9",
})

ALIASES = {
    "Blackburn": "Blackburn Rovers",
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
    "Preston": "Preston North End",
    "Preston North End": "Preston North End",
    "QPR": "Queens Park Rangers",
    "Queens Park Rangers": "Queens Park Rangers",
    "Sheffield Utd": "Sheffield United",
    "Sheffield United": "Sheffield United",
    "Sheffield Weds": "Sheffield Wednesday",
    "Sheffield Wednesday": "Sheffield Wednesday",
    "Southampton": "Southampton",
    "Stoke City": "Stoke City",
    "Swansea City": "Swansea City",
    "Watford": "Watford",
    "West Brom": "West Bromwich Albion",
    "West Bromwich Albion": "West Bromwich Albion",
    "Wrexham": "Wrexham",
}


def clean_team(value: str) -> str:
    v = re.sub(r"\s+", " ", (value or "").strip())
    return ALIASES.get(v, v)


def clean_int(value: str | None) -> int | None:
    if value is None:
        return None
    s = value.strip().replace(",", "")
    if not s or s in {"—", "-"}:
        return None
    m = re.search(r"-?\d+", s)
    return int(m.group(0)) if m else None


def cell_text(row, stat: str) -> str:
    cell = row.find(["th", "td"], attrs={"data-stat": stat})
    return cell.get_text(" ", strip=True) if cell else ""


def decomment(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")
    for node in soup.find_all(string=lambda text: isinstance(text, Comment)):
        text = str(node)
        if "<table" in text:
            node.replace_with(BeautifulSoup(text, "lxml"))
    return str(soup)


def fetch(url: str, cache_name: str, sleep_seconds: float = 3.2) -> str:
    path = CACHE / cache_name
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        return path.read_text(encoding="utf-8")

    last = None
    for attempt in range(6):
        try:
            response = SESSION.get(url, timeout=45)
            if response.status_code == 429:
                wait = 20 + attempt * 20
                print(f"429 from FBref; waiting {wait}s: {url}")
                time.sleep(wait)
                continue
            response.raise_for_status()
            text = response.text
            path.write_text(text, encoding="utf-8")
            time.sleep(sleep_seconds)
            return text
        except Exception as exc:
            last = exc
            wait = 5 * (attempt + 1)
            print(f"Fetch retry {attempt + 1}/6 after {exc}; waiting {wait}s")
            time.sleep(wait)
    raise RuntimeError(f"Failed to fetch {url}: {last}")


def find_table(html: str, *, required_stats: set[str], preferred_ids: tuple[str, ...] = ()):
    soup = BeautifulSoup(decomment(html), "lxml")
    for table_id in preferred_ids:
        table = soup.find("table", id=table_id)
        if table:
            stats = {c.get("data-stat") for c in table.find_all(["th", "td"]) if c.get("data-stat")}
            if required_stats.issubset(stats):
                return table
    for table in soup.find_all("table"):
        stats = {c.get("data-stat") for c in table.find_all(["th", "td"]) if c.get("data-stat")}
        if required_stats.issubset(stats):
            return table
    raise RuntimeError(f"Could not find table with columns: {sorted(required_stats)}")


def player_id_and_slug(row):
    cell = row.find(["th", "td"], attrs={"data-stat": "player"})
    if not cell:
        return "", ""
    anchor = cell.find("a", href=True)
    if not anchor:
        return "", ""
    m = re.search(r"/en/players/([^/]+)/([^/?#]+)", anchor["href"])
    return (m.group(1), m.group(2)) if m else ("", "")


def parse_aggregate_players():
    standard_html = fetch(STANDARD_URL, "league-standard.html")
    misc_html = fetch(MISC_URL, "league-misc.html")

    standard = find_table(
        standard_html,
        required_stats={"player", "squad", "games", "games_starts", "minutes", "cards_yellow", "cards_red"},
        preferred_ids=("stats_standard",),
    )
    misc = find_table(
        misc_html,
        required_stats={"player", "squad", "fouls", "fouled", "cards_yellow", "cards_red"},
        preferred_ids=("stats_misc",),
    )

    misc_by_key = {}
    for row in misc.select("tbody tr"):
        if "thead" in (row.get("class") or []):
            continue
        pid, _ = player_id_and_slug(row)
        squad = clean_team(cell_text(row, "squad"))
        if not pid or not squad or re.search(r"\d+ squads?$", squad, re.I):
            continue
        misc_by_key[(pid, squad)] = {
            "fouls_committed": clean_int(cell_text(row, "fouls")),
            "fouls_drawn": clean_int(cell_text(row, "fouled")),
            "yellow_cards": clean_int(cell_text(row, "cards_yellow")),
            "red_cards": clean_int(cell_text(row, "cards_red")),
        }

    baselines = []
    players = {}
    for row in standard.select("tbody tr"):
        if "thead" in (row.get("class") or []):
            continue
        pid, slug = player_id_and_slug(row)
        name = cell_text(row, "player")
        squad = clean_team(cell_text(row, "squad"))
        if not pid or not name or not squad or re.search(r"\d+ squads?$", squad, re.I):
            continue
        appearances = clean_int(cell_text(row, "games"))
        starts = clean_int(cell_text(row, "games_starts"))
        minutes = clean_int(cell_text(row, "minutes"))
        std_y = clean_int(cell_text(row, "cards_yellow"))
        std_r = clean_int(cell_text(row, "cards_red"))
        misc_rec = misc_by_key.get((pid, squad), {})
        yellows = misc_rec.get("yellow_cards") if misc_rec.get("yellow_cards") is not None else std_y
        reds = misc_rec.get("red_cards") if misc_rec.get("red_cards") is not None else std_r
        fouls = misc_rec.get("fouls_committed")
        drawn = misc_rec.get("fouls_drawn")
        p90 = minutes / 90 if minutes else 0
        baselines.append({
            "player_name": name,
            "team": squad,
            "competition": COMPETITION,
            "season": SEASON_LABEL,
            "appearances": appearances,
            "starts": starts,
            "minutes": minutes,
            "yellow_cards": yellows,
            "red_cards": reds,
            "fouls_committed": fouls,
            "fouls_drawn": drawn,
            "fouls_per_90": round(fouls / p90, 4) if fouls is not None and p90 else None,
            "cards_per_90": round(yellows / p90, 4) if yellows is not None and p90 else None,
            "position": cell_text(row, "position"),
            "external_player_id": pid,
        })
        players[pid] = {"id": pid, "slug": slug, "name": name}

    if len(baselines) < 450 or len(players) < 450:
        raise RuntimeError(f"Aggregate player scrape unexpectedly small: {len(baselines)} baselines / {len(players)} players")
    return baselines, list(players.values())


def parse_schedule():
    html = fetch(SCHEDULE_URL, "schedule.html")
    table = find_table(
        html,
        required_stats={"date", "home_team", "away_team", "referee"},
        preferred_ids=(f"sched_{SEASON}_{COMP_ID}_1",),
    )
    matches = []
    lookup = {}
    for row in table.select("tbody tr"):
        date = cell_text(row, "date")
        home = clean_team(cell_text(row, "home_team"))
        away = clean_team(cell_text(row, "away_team"))
        referee = cell_text(row, "referee")
        if not date or not home or not away or not referee:
            continue
        record = {"date": date, "home": home, "away": away, "referee": referee}
        matches.append(record)
        lookup[(date, home.casefold(), away.casefold())] = referee
        lookup[(date, frozenset((home.casefold(), away.casefold())))] = referee
    if len(matches) < 500:
        raise RuntimeError(f"Schedule scrape unexpectedly small: {len(matches)} completed matches")
    return matches, lookup


def referee_for(lookup, date: str, team: str, opponent: str, venue: str) -> str:
    team = clean_team(team)
    opponent = clean_team(opponent)
    if venue.casefold() == "home":
        direct = lookup.get((date, team.casefold(), opponent.casefold()))
    else:
        direct = lookup.get((date, opponent.casefold(), team.casefold()))
    if direct:
        return direct
    return lookup.get((date, frozenset((team.casefold(), opponent.casefold()))), "")


def parse_player_matchlogs(players, schedule_lookup):
    h2h = []
    failures = []
    missing_referee = []

    for index, p in enumerate(players, start=1):
        url = f"{BASE}/en/players/{p['id']}/matchlogs/{SEASON}/c{COMP_ID}/{p['slug']}-Match-Logs"
        print(f"[{index}/{len(players)}] {p['name']}")
        try:
            html = fetch(url, f"players/{p['id']}.html")
            table = find_table(
                html,
                required_stats={"date", "venue", "squad", "opponent", "minutes", "cards_yellow", "cards_red", "fouls", "fouled"},
            )
        except Exception as exc:
            failures.append({"player_id": p["id"], "player_name": p["name"], "url": url, "error": str(exc)})
            continue

        seen = set()
        for row in table.select("tbody tr"):
            date = cell_text(row, "date")
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date or ""):
                continue
            minutes = clean_int(cell_text(row, "minutes"))
            if minutes is None:
                continue
            team = clean_team(cell_text(row, "squad"))
            opponent = clean_team(cell_text(row, "opponent"))
            venue = cell_text(row, "venue").casefold()
            if venue not in {"home", "away"} or not team or not opponent:
                continue
            dedupe_key = (p["id"], date, team, opponent)
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            referee = referee_for(schedule_lookup, date, team, opponent, venue)
            if not referee:
                missing_referee.append({"player_id": p["id"], "player_name": p["name"], "date": date, "team": team, "opponent": opponent, "venue": venue})
            h2h.append({
                "player_name": p["name"],
                "team": team,
                "opponent": opponent,
                "match_date": date,
                "competition": COMPETITION,
                "venue": venue,
                "minutes": minutes,
                "fouls_committed": clean_int(cell_text(row, "fouls")),
                "fouls_drawn": clean_int(cell_text(row, "fouled")),
                "yellow_card": 1 if (clean_int(cell_text(row, "cards_yellow")) or 0) > 0 else 0,
                "red_card": 1 if (clean_int(cell_text(row, "cards_red")) or 0) > 0 else 0,
                "external_player_id": p["id"],
                "_referee": referee,
            })

    return h2h, failures, missing_referee


def build_referee_tables(matches, h2h):
    matches_by_ref = Counter(m["referee"] for m in matches if m["referee"])
    events_by_ref = defaultdict(lambda: {"yellow": 0, "red": 0, "fouls": 0})
    pr = defaultdict(lambda: {"matches": 0, "yellow": 0, "red": 0, "fouls": 0, "teams": Counter()})

    for row in h2h:
        ref = row["_referee"]
        if not ref:
            continue
        events_by_ref[ref]["yellow"] += row["yellow_card"]
        events_by_ref[ref]["red"] += row["red_card"]
        events_by_ref[ref]["fouls"] += row["fouls_committed"] or 0
        key = (ref, row["external_player_id"], row["player_name"])
        rec = pr[key]
        rec["matches"] += 1
        rec["yellow"] += row["yellow_card"]
        rec["red"] += row["red_card"]
        rec["fouls"] += row["fouls_committed"] or 0
        rec["teams"][row["team"]] += 1

    referee_rows = []
    for ref, match_count in sorted(matches_by_ref.items()):
        e = events_by_ref[ref]
        referee_rows.append({
            "referee_name": ref,
            "matches_refereed": match_count,
            "yellow_cards": e["yellow"],
            "red_cards": e["red"],
            "yellows_per_game": round(e["yellow"] / match_count, 4) if match_count else None,
            "fouls_per_game": round(e["fouls"] / match_count, 4) if match_count else None,
            "competition": COMPETITION,
            "season": SEASON_LABEL,
            "external_referee_id": "",
        })

    player_ref_rows = []
    for (ref, pid, name), rec in sorted(pr.items(), key=lambda x: (x[0][0], x[0][2])):
        team = rec["teams"].most_common(1)[0][0] if rec["teams"] else ""
        player_ref_rows.append({
            "referee_name": ref,
            "player_name": name,
            "team": team,
            "competition": COMPETITION,
            "season": SEASON_LABEL,
            "matches_together": rec["matches"],
            "yellow_cards": rec["yellow"],
            "red_cards": rec["red"],
            "fouls_committed": rec["fouls"],
            "external_referee_id": "",
            "external_player_id": pid,
        })
    return referee_rows, player_ref_rows


def compare_baselines(baselines, h2h):
    agg = defaultdict(lambda: {"appearances": 0, "minutes": 0, "yellow_cards": 0, "red_cards": 0, "fouls_committed": 0, "fouls_drawn": 0})
    for row in h2h:
        key = (row["external_player_id"], row["team"])
        a = agg[key]
        a["appearances"] += 1
        a["minutes"] += row["minutes"] or 0
        a["yellow_cards"] += row["yellow_card"]
        a["red_cards"] += row["red_card"]
        a["fouls_committed"] += row["fouls_committed"] or 0
        a["fouls_drawn"] += row["fouls_drawn"] or 0

    mismatches = []
    for b in baselines:
        key = (b["external_player_id"], b["team"])
        a = agg.get(key)
        if not a:
            if (b["appearances"] or 0) > 0:
                mismatches.append({"player": b["player_name"], "team": b["team"], "reason": "no match log rows"})
            continue
        diffs = {}
        for stat in ("appearances", "minutes", "yellow_cards", "red_cards", "fouls_committed", "fouls_drawn"):
            bv = b.get(stat)
            av = a.get(stat)
            if bv is not None and av is not None and bv != av:
                diffs[stat] = {"baseline": bv, "match_logs": av}
        if diffs:
            mismatches.append({"player": b["player_name"], "team": b["team"], "diffs": diffs})
    return mismatches


def write_csv(name: str, rows: list[dict], fields: list[str]):
    with (OUT / name).open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: "" if row.get(k) is None else row.get(k) for k in fields})


def main():
    baselines, players = parse_aggregate_players()
    matches, schedule_lookup = parse_schedule()
    h2h, failures, missing_referee = parse_player_matchlogs(players, schedule_lookup)
    referee_rows, player_ref_rows = build_referee_tables(matches, h2h)
    mismatches = compare_baselines(baselines, h2h)
    clean_h2h = [{k: v for k, v in row.items() if not k.startswith("_")} for row in h2h]

    write_csv("player_baselines.csv", baselines, [
        "player_name", "team", "competition", "season", "appearances", "starts", "minutes",
        "yellow_cards", "red_cards", "fouls_committed", "fouls_drawn", "fouls_per_90", "cards_per_90",
        "position", "external_player_id",
    ])
    write_csv("h2h.csv", clean_h2h, [
        "player_name", "team", "opponent", "match_date", "competition", "venue", "minutes",
        "fouls_committed", "fouls_drawn", "yellow_card", "red_card", "external_player_id",
    ])
    write_csv("referees.csv", referee_rows, [
        "referee_name", "matches_refereed", "yellow_cards", "red_cards", "yellows_per_game", "fouls_per_game",
        "competition", "season", "external_referee_id",
    ])
    write_csv("player_referee_history.csv", player_ref_rows, [
        "referee_name", "player_name", "team", "competition", "season", "matches_together", "yellow_cards",
        "red_cards", "fouls_committed", "external_referee_id", "external_player_id",
    ])

    report = {
        "competition": COMPETITION,
        "season": SEASON_LABEL,
        "source": "FBref",
        "source_urls": {"standard": STANDARD_URL, "misc": MISC_URL, "schedule": SCHEDULE_URL},
        "counts": {
            "player_baselines": len(baselines),
            "unique_players": len(players),
            "schedule_matches_with_referee": len(matches),
            "h2h_player_match_rows": len(clean_h2h),
            "referees": len(referee_rows),
            "player_referee_rows": len(player_ref_rows),
            "player_matchlog_failures": len(failures),
            "h2h_rows_missing_referee": len(missing_referee),
            "baseline_matchlog_mismatches": len(mismatches),
        },
        "notes": [
            "Missing source values remain blank rather than being converted to zero.",
            "Home/away comes directly from each FBref player match log.",
            "Referees are joined from the FBref Championship schedule using date, team, opponent and venue.",
            "Player-referee history is aggregated only from player appearances with a resolved referee.",
        ],
        "failures": failures,
        "missing_referee_examples": missing_referee[:100],
        "baseline_matchlog_mismatch_examples": mismatches[:200],
    }
    (OUT / "quality-report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(report["counts"], indent=2))

    if len(baselines) < 500:
        raise SystemExit("Refusing to publish: fewer than 500 Championship baseline rows")
    if len(clean_h2h) < 9000:
        raise SystemExit("Refusing to publish: fewer than 9,000 Championship player-match rows")
    if len(referee_rows) < 20:
        raise SystemExit("Refusing to publish: fewer than 20 Championship referees")
    if len(player_ref_rows) < 4000:
        raise SystemExit("Refusing to publish: fewer than 4,000 player-referee rows")
    if len(failures) > max(15, int(len(players) * 0.05)):
        raise SystemExit(f"Refusing to publish: too many player match-log failures ({len(failures)}/{len(players)})")


if __name__ == "__main__":
    main()
