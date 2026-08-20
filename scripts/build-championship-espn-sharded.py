from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
LEGACY_PATH = ROOT / "scripts" / "build-championship-espn.py"
BUILD = ROOT / ".build" / "championship"
EVENTS_PATH = BUILD / "events.json"
SHARDS_DIR = BUILD / "shards"
SEASON = 2025
SHARD_COUNT = 12


def load_builder():
    spec = importlib.util.spec_from_file_location("championship_espn_builder", LEGACY_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {LEGACY_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def team_ids_from(data: dict[str, Any]) -> list[str]:
    ids: set[str] = set()

    def add(entry: Any) -> None:
        if not isinstance(entry, dict):
            return
        team = entry.get("team") if isinstance(entry.get("team"), dict) else entry
        team_id = str(team.get("id") or "")
        if team_id:
            ids.add(team_id)

    for entry in data.get("teams") or []:
        add(entry)
    for sport in data.get("sports") or []:
        for league in sport.get("leagues") or []:
            for entry in league.get("teams") or []:
                add(entry)
    return sorted(ids)


def discover() -> None:
    builder = load_builder()
    BUILD.mkdir(parents=True, exist_ok=True)

    teams = builder.cached_get(f"{builder.BASE}/teams", "teams-2025-26")
    team_ids = team_ids_from(teams)
    if len(team_ids) != 24:
        raise RuntimeError(f"Expected 24 Championship teams, found {len(team_ids)}: {team_ids}")

    events: dict[str, dict[str, Any]] = {}
    for index, team_id in enumerate(team_ids, 1):
        schedule = builder.cached_get(
            f"{builder.BASE}/teams/{team_id}/schedule?season={SEASON}",
            f"schedule-{SEASON}-{team_id}",
        )
        for event in schedule.get("events") or []:
            event_id = str(event.get("id") or "")
            event_day = builder.event_date(event)
            if event_id and builder.START_DATE.isoformat() <= event_day <= builder.END_DATE.isoformat():
                events[event_id] = event
        print(f"Schedules {index}/24; unique regular-season events={len(events)}", flush=True)

    ordered = sorted(events.values(), key=lambda e: (builder.event_date(e), str(e.get("id") or "")))
    if len(ordered) != 552:
        raise RuntimeError(
            f"Expected 552 Championship regular-season fixtures from team schedules, found {len(ordered)}. "
            "Failing before summary requests so incomplete data cannot be built."
        )

    EVENTS_PATH.write_text(json.dumps(ordered), encoding="utf-8")
    print(f"Discovered and saved {len(ordered)} Championship fixtures", flush=True)


def shard(index: int, count: int) -> None:
    builder = load_builder()
    if not EVENTS_PATH.exists():
        raise RuntimeError(f"Missing discovery artifact: {EVENTS_PATH}")
    events = json.loads(EVENTS_PATH.read_text(encoding="utf-8"))
    selected = events[index::count]
    if not selected:
        raise RuntimeError(f"Shard {index}/{count} has no events")

    rows: list[dict[str, Any]] = []
    meta: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    # Intentionally sequential: each shard only handles ~46 summaries, which avoids
    # hammering ESPN from one runner and removes requests.Session thread-safety risk.
    for completed, event in enumerate(selected, 1):
        try:
            event_rows, event_meta = builder.parse_event(event)
            rows.extend(event_rows)
            meta.append(event_meta)
        except Exception as exc:
            failures.append({
                "event_id": event.get("id"),
                "date": builder.event_date(event),
                "error": str(exc),
            })
        if completed % 10 == 0 or completed == len(selected):
            print(
                f"Shard {index}: {completed}/{len(selected)} summaries; "
                f"rows={len(rows)} failures={len(failures)}",
                flush=True,
            )

    SHARDS_DIR.mkdir(parents=True, exist_ok=True)
    output = SHARDS_DIR / f"shard-{index:02d}.json"
    output.write_text(json.dumps({"rows": rows, "meta": meta, "failures": failures}), encoding="utf-8")
    if len(failures) > 1:
        raise RuntimeError(f"Shard {index} exceeded failure allowance: {len(failures)}")


def aggregate(count: int) -> None:
    builder = load_builder()
    if not EVENTS_PATH.exists():
        raise RuntimeError(f"Missing discovery artifact: {EVENTS_PATH}")
    events = json.loads(EVENTS_PATH.read_text(encoding="utf-8"))

    by_event: dict[str, tuple[list[dict[str, Any]], dict[str, Any]]] = {}
    failures: list[dict[str, Any]] = []
    missing_shards: list[int] = []
    for index in range(count):
        path = SHARDS_DIR / f"shard-{index:02d}.json"
        if not path.exists():
            missing_shards.append(index)
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        failures.extend(payload.get("failures") or [])
        rows_by_event: dict[str, list[dict[str, Any]]] = {}
        for row in payload.get("rows") or []:
            # Rows do not carry the ESPN event ID, so pair them back to metadata by
            # date/home/away through the deterministic shard event ordering below.
            # We instead rebuild a queue using each selected event and its meta entry.
            pass

        selected = events[index::count]
        meta_rows = payload.get("meta") or []
        meta_by_id = {str(m.get("event_id") or ""): m for m in meta_rows}
        # parse_event output rows are contiguous per event in the shard payload. Use
        # each metadata player count to slice them back into exact per-event groups.
        cursor = 0
        raw_rows = payload.get("rows") or []
        for event in selected:
            event_id = str(event.get("id") or "")
            meta = meta_by_id.get(event_id)
            if meta is None:
                continue
            player_count = int(meta.get("players") or 0)
            event_rows = raw_rows[cursor:cursor + player_count]
            cursor += player_count
            by_event[event_id] = (event_rows, meta)
        if cursor != len(raw_rows):
            raise RuntimeError(f"Shard {index} row reconstruction mismatch: consumed {cursor}, found {len(raw_rows)}")

    if missing_shards:
        raise RuntimeError(f"Missing shard artifacts: {missing_shards}")
    if len(failures) > 5:
        raise RuntimeError(f"Too many summary failures before aggregation: {len(failures)}")

    def collect_events_override():
        return events

    def parse_event_override(event: dict[str, Any]):
        event_id = str(event.get("id") or "")
        if event_id not in by_event:
            failure = next((f for f in failures if str(f.get("event_id") or "") == event_id), None)
            raise RuntimeError((failure or {}).get("error") or f"No shard result for event {event_id}")
        return by_event[event_id]

    builder.collect_events = collect_events_override
    builder.parse_event = parse_event_override
    builder.main()


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("discover")
    shard_parser = sub.add_parser("shard")
    shard_parser.add_argument("--index", type=int, required=True)
    shard_parser.add_argument("--count", type=int, default=SHARD_COUNT)
    aggregate_parser = sub.add_parser("aggregate")
    aggregate_parser.add_argument("--count", type=int, default=SHARD_COUNT)
    args = parser.parse_args()

    if args.command == "discover":
        discover()
    elif args.command == "shard":
        shard(args.index, args.count)
    else:
        aggregate(args.count)


if __name__ == "__main__":
    main()
