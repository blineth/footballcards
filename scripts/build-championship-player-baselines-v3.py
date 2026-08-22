from __future__ import annotations

import io
import json
import re
import time
import unicodedata
from pathlib import Path
from typing import Any

import pandas as pd
import requests
from bs4 import BeautifulSoup, Comment

OUT = Path('data/championship')
OUT.mkdir(parents=True, exist_ok=True)

FBREF_BASE = 'https://fbref.com/en/comps'
ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.2'
UA = 'Mozilla/5.0 (compatible; footballcards-research/5.0)'
SESSION = requests.Session()
SESSION.headers.update({'User-Agent': UA, 'Accept-Language': 'en-GB,en;q=0.9'})


def norm(value: Any) -> str:
    s = unicodedata.normalize('NFKD', str(value or ''))
    s = ''.join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r'[^a-z0-9]+', ' ', s.lower()).strip()


def get(url: str, attempts: int = 6) -> requests.Response:
    last: Exception | None = None
    for i in range(attempts):
        try:
            response = SESSION.get(url, timeout=30)
            if response.status_code in (403, 429):
                wait = min(45, 4 + i * 7)
                print(f'Rate limited ({response.status_code}) on {url}; waiting {wait}s', flush=True)
                time.sleep(wait)
                continue
            response.raise_for_status()
            return response
        except Exception as exc:
            last = exc
            time.sleep(min(20, 2 + i * 3))
    raise RuntimeError(f'Failed to fetch {url}: {last}')


def flatten_columns(df: pd.DataFrame) -> pd.DataFrame:
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [str(c[-1] if c[-1] and 'Unnamed' not in str(c[-1]) else c[0]).strip() for c in df.columns]
    else:
        df.columns = [str(c).strip() for c in df.columns]
    return df


def fbref_tables(url: str) -> list[pd.DataFrame]:
    text = get(url).text
    candidates = [text]
    soup = BeautifulSoup(text, 'html.parser')
    candidates.extend(str(c) for c in soup.find_all(string=lambda x: isinstance(x, Comment)) if '<table' in str(c))
    frames: list[pd.DataFrame] = []
    for html in candidates:
        try:
            frames.extend(pd.read_html(io.StringIO(html)))
        except ValueError:
            pass
    return [flatten_columns(frame) for frame in frames]


def player_table(comp: int, season: str, section: str) -> pd.DataFrame:
    url = f'{FBREF_BASE}/{comp}/{season}/{section}/{season}-Stats'
    frames = fbref_tables(url)
    options: list[pd.DataFrame] = []
    for frame in frames:
        cols = set(frame.columns)
        if 'Player' not in cols or 'Squad' not in cols:
            continue
        if section == 'stats' and {'CrdY', 'CrdR'}.issubset(cols):
            options.append(frame)
        elif section == 'misc' and ('Fls' in cols or 'Fld' in cols):
            options.append(frame)
        elif section == 'shooting' and ('Sh' in cols or 'SoT' in cols):
            options.append(frame)
    if not options:
        raise RuntimeError(f'No FBref player {section} table found at {url}')
    time.sleep(2)
    return max(options, key=len).copy()


def dedupe_player_rows(df: pd.DataFrame) -> pd.DataFrame:
    df = df[df['Player'].astype(str).str.lower() != 'player'].copy()
    df['player_key'] = df['Player'].map(norm)
    df['squad_key'] = df['Squad'].map(norm)
    return df.drop_duplicates(['player_key', 'squad_key'])


def numeric(series: pd.Series | None) -> pd.Series:
    if series is None:
        return pd.Series(dtype='float64')
    return pd.to_numeric(series.astype(str).str.replace(',', '', regex=False), errors='coerce').fillna(0)


def merge_fbref(comp: int, season: str, competition: str) -> pd.DataFrame:
    standard = dedupe_player_rows(player_table(comp, season, 'stats'))
    misc = dedupe_player_rows(player_table(comp, season, 'misc'))
    shooting = dedupe_player_rows(player_table(comp, season, 'shooting'))
    keys = ['player_key', 'squad_key']
    out = standard.merge(misc[keys + [c for c in ['Fls', 'Fld'] if c in misc.columns]], on=keys, how='left')
    out = out.merge(shooting[keys + [c for c in ['Sh', 'SoT'] if c in shooting.columns]], on=keys, how='left')
    out['competition_source'] = competition
    out['season_source'] = season
    return out


def current_espn_rosters() -> pd.DataFrame:
    teams = get(f'{ESPN_BASE}/teams').json()
    entries: list[dict[str, Any]] = []
    for sport in teams.get('sports') or []:
        for league in sport.get('leagues') or []:
            entries.extend(league.get('teams') or [])
    entries.extend(teams.get('teams') or [])

    ids: dict[str, str] = {}
    for entry in entries:
        team = entry.get('team') if isinstance(entry, dict) and isinstance(entry.get('team'), dict) else entry
        if not isinstance(team, dict):
            continue
        team_id = str(team.get('id') or '')
        team_name = str(team.get('displayName') or team.get('name') or '')
        if team_id and team_name:
            ids[team_id] = team_name
    if len(ids) != 24:
        raise RuntimeError(f'Expected 24 current Championship clubs from ESPN, found {len(ids)}')

    rows: list[dict[str, Any]] = []
    for idx, (team_id, team_name) in enumerate(sorted(ids.items()), 1):
        roster = get(f'{ESPN_BASE}/teams/{team_id}/roster').json()
        athletes = roster.get('athletes') or []
        for athlete in athletes:
            player_name = str(athlete.get('displayName') or athlete.get('fullName') or '').strip()
            if not player_name:
                continue
            position = athlete.get('position') or {}
            rows.append({
                'player_name': player_name,
                'player_key': norm(player_name),
                'current_team': team_name,
                'current_team_key': norm(team_name),
                'position': position.get('displayName') or position.get('abbreviation') or '',
                'external_player_id': str(athlete.get('id') or ''),
            })
        print(f'Roster {idx}/24: {team_name} ({len(athletes)} players)', flush=True)
        time.sleep(0.3)

    roster_df = pd.DataFrame(rows).drop_duplicates(['player_key', 'current_team_key'])
    if roster_df['current_team'].nunique() != 24:
        raise RuntimeError('Roster extraction did not retain all 24 Championship clubs')
    if len(roster_df) < 400:
        raise RuntimeError(f'Current roster extraction looks incomplete: only {len(roster_df)} players')
    return roster_df


def pick_previous(rows: pd.DataFrame) -> pd.DataFrame:
    numeric_cols = ['MP', 'Starts', 'Min', 'CrdY', 'CrdR', 'Fls', 'Fld', 'Sh', 'SoT', 'Gls']
    result: list[pd.Series] = []
    for _, group in rows.groupby('player_key', sort=False):
        total_rows = group[group['Squad'].astype(str).str.upper().eq('TOT')]
        if len(total_rows):
            row = total_rows.iloc[0].copy()
        else:
            row = group.iloc[0].copy()
            for col in numeric_cols:
                if col in group.columns:
                    row[col] = numeric(group[col]).sum()
            row['Squad'] = ' / '.join(dict.fromkeys(group['Squad'].astype(str)))
            row['competition_source'] = ' / '.join(dict.fromkeys(group['competition_source'].astype(str)))
        result.append(row)
    return pd.DataFrame(result)


def value(row: pd.Series | None, col: str) -> int | None:
    if row is None or col not in row.index or pd.isna(row.get(col)):
        return None
    try:
        return int(float(str(row.get(col)).replace(',', '')))
    except Exception:
        return None


def choose_current_fbref(roster_row: pd.Series, current: pd.DataFrame) -> pd.Series | None:
    candidates = current[current['player_key'] == roster_row['player_key']]
    if candidates.empty:
        return None
    exact_team = candidates[candidates['squad_key'] == roster_row['current_team_key']]
    if not exact_team.empty:
        return exact_team.iloc[0]
    if len(candidates) == 1:
        return candidates.iloc[0]
    return candidates.sort_values('Min', ascending=False).iloc[0]


def per90(total: int | None, minutes: int | None) -> float | None:
    if total is None or minutes is None:
        return None
    if minutes == 0:
        return 0.0
    return round(total / (minutes / 90), 4)


def main() -> None:
    print('Loading complete current ESPN Championship rosters...', flush=True)
    roster = current_espn_rosters()

    print('Loading FBref 2026/27 Championship season-to-date player tables...', flush=True)
    current = merge_fbref(10, '2026-2027', 'Championship')

    print('Loading FBref 2025/26 comparison leagues...', flush=True)
    previous_parts: list[pd.DataFrame] = []
    previous_warnings: list[str] = []
    for comp, label in [(9, 'Premier League'), (10, 'Championship'), (11, 'League One')]:
        try:
            previous_parts.append(merge_fbref(comp, '2025-2026', label))
        except Exception as exc:
            warning = f'{label}: {exc}'
            previous_warnings.append(warning)
            print(f'Previous-season source warning: {warning}', flush=True)
    if not previous_parts:
        raise RuntimeError('No 2025/26 FBref comparison tables could be loaded')
    previous = pick_previous(pd.concat(previous_parts, ignore_index=True))
    prev_by_player = {row['player_key']: row for _, row in previous.iterrows()}

    rows: list[dict[str, Any]] = []
    unmatched_current: list[str] = []
    for _, roster_row in roster.iterrows():
        current_row = choose_current_fbref(roster_row, current)
        previous_row = prev_by_player.get(roster_row['player_key'])
        if current_row is None:
            unmatched_current.append(f"{roster_row['player_name']} ({roster_row['current_team']})")

        minutes = value(current_row, 'Min')
        yellows = value(current_row, 'CrdY')
        fouls = value(current_row, 'Fls')
        shots = value(current_row, 'Sh')
        shots_on_target = value(current_row, 'SoT')

        rows.append({
            'player_name': roster_row['player_name'],
            'current_team': roster_row['current_team'],
            'position': roster_row['position'] or (current_row.get('Pos', '') if current_row is not None else ''),
            'external_player_id': roster_row['external_player_id'],
            'season': '2026/27',
            'current_stats_status': 'matched_fbref' if current_row is not None else 'no_fbref_appearance_row',
            'appearances': value(current_row, 'MP'),
            'starts': value(current_row, 'Starts'),
            'minutes': minutes,
            'goals': value(current_row, 'Gls'),
            'yellow_cards': yellows,
            'red_cards': value(current_row, 'CrdR'),
            'fouls_committed': fouls,
            'fouls_drawn': value(current_row, 'Fld'),
            'shots': shots,
            'shots_on_target': shots_on_target,
            'yellow_cards_per_90': per90(yellows, minutes),
            'fouls_per_90': per90(fouls, minutes),
            'shots_per_90': per90(shots, minutes),
            'shots_on_target_per_90': per90(shots_on_target, minutes),
            'previous_stats_status': 'matched_fbref' if previous_row is not None else 'no_previous_match',
            'previous_season_team': previous_row.get('Squad', '') if previous_row is not None else '',
            'previous_season_competition': previous_row.get('competition_source', '') if previous_row is not None else '',
            'previous_appearances': value(previous_row, 'MP'),
            'previous_minutes': value(previous_row, 'Min'),
            'previous_goals': value(previous_row, 'Gls'),
            'previous_yellow_cards': value(previous_row, 'CrdY'),
            'previous_red_cards': value(previous_row, 'CrdR'),
            'previous_fouls_committed': value(previous_row, 'Fls'),
            'previous_fouls_drawn': value(previous_row, 'Fld'),
            'previous_shots': value(previous_row, 'Sh'),
            'previous_shots_on_target': value(previous_row, 'SoT'),
        })

    out = pd.DataFrame(rows)
    sort_yellows = pd.to_numeric(out['yellow_cards'], errors='coerce').fillna(-1)
    sort_fouls = pd.to_numeric(out['fouls_committed'], errors='coerce').fillna(-1)
    sort_minutes = pd.to_numeric(out['minutes'], errors='coerce').fillna(-1)
    out = out.assign(_y=sort_yellows, _f=sort_fouls, _m=sort_minutes).sort_values(['_y', '_f', '_m'], ascending=False).drop(columns=['_y', '_f', '_m'])
    path = OUT / 'current_player_baselines.csv'
    out.to_csv(path, index=False)

    matched_current = int((out['current_stats_status'] == 'matched_fbref').sum())
    report = {
        'generated_for': 'complete current 2026/27 Championship squads',
        'primary_stat_source': 'FBref player standard, misc and shooting tables',
        'current_roster_source': 'ESPN Championship roster API',
        'previous_season_sources_requested': ['2025/26 Premier League', '2025/26 Championship', '2025/26 League One'],
        'previous_source_warnings': previous_warnings,
        'players': int(len(out)),
        'clubs': int(out['current_team'].nunique()),
        'players_with_current_fbref_row': matched_current,
        'players_without_current_fbref_row': int(len(out) - matched_current),
        'players_with_previous_season_match': int((out['previous_stats_status'] == 'matched_fbref').sum()),
        'current_fbref_match_rate': round(matched_current / len(out), 4) if len(out) else 0,
        'unmatched_current_players': unmatched_current,
        'columns': list(out.columns),
    }
    (OUT / 'current-player-quality-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')

    if report['clubs'] != 24:
        raise RuntimeError(f'Expected 24 current Championship clubs, found {report["clubs"]}')
    if report['players'] < 400:
        raise RuntimeError(f'Expected at least 400 current squad players, found {report["players"]}')
    if report['players_with_current_fbref_row'] < 250:
        raise RuntimeError(f'Current FBref match coverage is unexpectedly low: {report["players_with_current_fbref_row"]}')

    current_matched = out[out['current_stats_status'] == 'matched_fbref']
    if pd.to_numeric(current_matched['yellow_cards'], errors='coerce').fillna(0).sum() < 1:
        raise RuntimeError('Current-season yellow-card totals are unexpectedly zero')
    if pd.to_numeric(current_matched['fouls_committed'], errors='coerce').fillna(0).sum() < 1:
        raise RuntimeError('Current-season foul totals are unexpectedly zero')

    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    main()
