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
UA = 'Mozilla/5.0 (compatible; footballcards-research/4.0)'
SESSION = requests.Session()
SESSION.headers.update({'User-Agent': UA, 'Accept-Language': 'en-GB,en;q=0.9'})


def norm(value: Any) -> str:
    s = unicodedata.normalize('NFKD', str(value or ''))
    s = ''.join(ch for ch in s if not unicodedata.combining(ch))
    s = re.sub(r'[^a-z0-9]+', ' ', s.lower()).strip()
    return s


def get(url: str, attempts: int = 5) -> requests.Response:
    last: Exception | None = None
    for i in range(attempts):
        try:
            r = SESSION.get(url, timeout=30)
            if r.status_code in (403, 429):
                time.sleep(2 + i * 3)
                continue
            r.raise_for_status()
            return r
        except Exception as exc:
            last = exc
            time.sleep(1 + i * 2)
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
    return [flatten_columns(f) for f in frames]


def player_table(comp: int, season: str, section: str) -> pd.DataFrame:
    slug = {'stats': 'stats', 'misc': 'misc', 'shooting': 'shooting'}[section]
    url = f'{FBREF_BASE}/{comp}/{season}/{slug}/{season}-Stats'
    frames = fbref_tables(url)
    options = []
    for f in frames:
        cols = set(f.columns)
        if 'Player' not in cols or 'Squad' not in cols:
            continue
        if section == 'stats' and {'CrdY', 'CrdR'}.issubset(cols):
            options.append(f)
        elif section == 'misc' and ('Fls' in cols or 'Fld' in cols):
            options.append(f)
        elif section == 'shooting' and ('Sh' in cols or 'SoT' in cols):
            options.append(f)
    if not options:
        raise RuntimeError(f'No FBref player {section} table found at {url}')
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


def current_espn_rosters() -> tuple[dict[str, str], set[str]]:
    teams = get(f'{ESPN_BASE}/teams').json()
    entries = []
    for sport in teams.get('sports') or []:
        for league in sport.get('leagues') or []:
            entries.extend(league.get('teams') or [])
    entries.extend(teams.get('teams') or [])
    ids: dict[str, str] = {}
    for e in entries:
        team = e.get('team') if isinstance(e, dict) and isinstance(e.get('team'), dict) else e
        if not isinstance(team, dict):
            continue
        tid = str(team.get('id') or '')
        name = str(team.get('displayName') or team.get('name') or '')
        if tid and name:
            ids[tid] = name
    if len(ids) != 24:
        raise RuntimeError(f'Expected 24 current Championship clubs from ESPN, found {len(ids)}')
    current_names: set[str] = set()
    player_to_team: dict[str, str] = {}
    for idx, (tid, team_name) in enumerate(sorted(ids.items()), 1):
        roster = get(f'{ESPN_BASE}/teams/{tid}/roster').json()
        athletes = roster.get('athletes') or []
        for athlete in athletes:
            name = str(athlete.get('displayName') or athlete.get('fullName') or '')
            if name:
                k = norm(name)
                current_names.add(k)
                player_to_team[k] = team_name
        print(f'Roster {idx}/24: {team_name} ({len(athletes)} players)', flush=True)
        time.sleep(0.2)
    return player_to_team, current_names


def pick_previous(rows: pd.DataFrame) -> pd.DataFrame:
    # If a player appeared in more than one league/club, keep a TOT row where FBref
    # provides one; otherwise aggregate their numeric production across rows.
    numeric_cols = ['MP', 'Starts', 'Min', 'CrdY', 'CrdR', 'Fls', 'Fld', 'Sh', 'SoT', 'Gls']
    result = []
    for key, group in rows.groupby('player_key', sort=False):
        total_rows = group[group['Squad'].astype(str).str.upper().eq('TOT')]
        if len(total_rows):
            r = total_rows.iloc[0].copy()
        else:
            r = group.iloc[0].copy()
            for c in numeric_cols:
                if c in group.columns:
                    r[c] = numeric(group[c]).sum()
            r['Squad'] = ' / '.join(dict.fromkeys(group['Squad'].astype(str)))
            r['competition_source'] = ' / '.join(dict.fromkeys(group['competition_source'].astype(str)))
        result.append(r)
    return pd.DataFrame(result)


def value(row: pd.Series, col: str) -> int:
    try:
        return int(float(str(row.get(col, 0)).replace(',', '')))
    except Exception:
        return 0


def main() -> None:
    print('Loading current ESPN Championship rosters...', flush=True)
    player_to_team, current_names = current_espn_rosters()

    print('Loading FBref 2026/27 Championship season-to-date player tables...', flush=True)
    current = merge_fbref(10, '2026-2027', 'Championship')
    current = current[current['player_key'].isin(current_names)].copy()
    current['current_team'] = current['player_key'].map(player_to_team)

    print('Loading FBref 2025/26 comparison leagues...', flush=True)
    previous_parts = []
    for comp, label in [(9, 'Premier League'), (10, 'Championship'), (11, 'League One')]:
        try:
            previous_parts.append(merge_fbref(comp, '2025-2026', label))
        except Exception as exc:
            print(f'Previous-season source warning for {label}: {exc}', flush=True)
    if not previous_parts:
        raise RuntimeError('No 2025/26 FBref comparison tables could be loaded')
    previous = pick_previous(pd.concat(previous_parts, ignore_index=True))
    previous = previous[previous['player_key'].isin(current_names)].copy()
    prev_by_player = {r['player_key']: r for _, r in previous.iterrows()}

    rows = []
    for _, r in current.iterrows():
        p = prev_by_player.get(r['player_key'])
        minutes = value(r, 'Min')
        nineties = minutes / 90 if minutes else 0
        yellows = value(r, 'CrdY')
        fouls = value(r, 'Fls')
        shots = value(r, 'Sh')
        sot = value(r, 'SoT')
        row = {
            'player_name': r.get('Player', ''),
            'current_team': r.get('current_team', r.get('Squad', '')),
            'position': r.get('Pos', ''),
            'season': '2026/27',
            'appearances': value(r, 'MP'),
            'starts': value(r, 'Starts'),
            'minutes': minutes,
            'goals': value(r, 'Gls'),
            'yellow_cards': yellows,
            'red_cards': value(r, 'CrdR'),
            'fouls_committed': fouls,
            'fouls_drawn': value(r, 'Fld'),
            'shots': shots,
            'shots_on_target': sot,
            'yellow_cards_per_90': round(yellows / nineties, 4) if nineties else 0,
            'fouls_per_90': round(fouls / nineties, 4) if nineties else 0,
            'shots_per_90': round(shots / nineties, 4) if nineties else 0,
            'shots_on_target_per_90': round(sot / nineties, 4) if nineties else 0,
            'previous_season_team': p.get('Squad', '') if p is not None else '',
            'previous_season_competition': p.get('competition_source', '') if p is not None else '',
            'previous_appearances': value(p, 'MP') if p is not None else 0,
            'previous_minutes': value(p, 'Min') if p is not None else 0,
            'previous_goals': value(p, 'Gls') if p is not None else 0,
            'previous_yellow_cards': value(p, 'CrdY') if p is not None else 0,
            'previous_red_cards': value(p, 'CrdR') if p is not None else 0,
            'previous_fouls_committed': value(p, 'Fls') if p is not None else 0,
            'previous_fouls_drawn': value(p, 'Fld') if p is not None else 0,
            'previous_shots': value(p, 'Sh') if p is not None else 0,
            'previous_shots_on_target': value(p, 'SoT') if p is not None else 0,
        }
        rows.append(row)

    out = pd.DataFrame(rows)
    out = out.sort_values(['yellow_cards', 'fouls_committed', 'minutes'], ascending=[False, False, False])
    path = OUT / 'current_player_baselines.csv'
    out.to_csv(path, index=False)

    report = {
        'generated_for': 'current 2026/27 Championship squads only',
        'primary_stat_source': 'FBref player standard, misc and shooting tables',
        'current_roster_validation': 'ESPN Championship team roster API',
        'previous_season_sources': ['2025/26 Premier League', '2025/26 Championship', '2025/26 League One'],
        'players': int(len(out)),
        'clubs': int(out['current_team'].nunique()),
        'players_with_previous_season_match': int((out['previous_season_team'].astype(str) != '').sum()),
        'columns': list(out.columns),
    }
    (OUT / 'current-player-quality-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')

    if report['clubs'] != 24:
        raise RuntimeError(f'Expected player rows across 24 current Championship clubs, found {report["clubs"]}')
    if report['players'] < 300:
        raise RuntimeError(f'Expected at least 300 current Championship players with appearances, found {report["players"]}')
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    main()
