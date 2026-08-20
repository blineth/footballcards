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
SHARD_COUNT = 12


def load_builder():
    spec = importlib.util.spec_from_file_location("championship_espn_builder", LEGACY_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {LEGACY_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def regular_season_events(builder, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    events: dict[str, dict[str, Any]] = {}
    start = builder.START_DATE.isoformat()
    end = builder.END_DATE.isoformat()
    for event in rows:
        event_id = str(event.get("id") or "")
        event_day = builder.event_date(event)
        if event_id and start <= event_day <= end:
            events[event_id] = event
    return sorted(events.values(), key=lambda e: (builder.event_date(e), str(e.get("id") or "")))


def discover() -> None:
    builder = load_builder()
    BUILD.mkdir(parents=True, exist_ok=True)

    # ESPN scoreboards accept date windows. This replaces 276 one-day calls and is
    # explicitly tied to the 2025/26 regular-season window rather than current teams.
    start = builder.START_DATE.strftime("%Y%m%d")
    end = builder.END_DATE.strftime("%Y%m%d")
    window = builder.cached_get(
        f"{builder.BASE}/scoreboard?dates={start}-{end}&limit=1000",
        f"scoreboard-window-{start}-{end}",
    )
    ordered = regular_season_events(builder, window.get("events") or [])

    # Some ESPN scoreboard implementations cap wide date windows. If that happens,
    # make only two yearly calls, merge them, and still fail closed unless all 552
    # regular-season fixtures are present.
    if len(ordered) != 552:
        merged: list[dict[str, Any]] = []
        for year in (2025, 2026):
            data = builder.cached_get(
                f"{builder.BASE}/scoreboard?dates={year}&limit=1000",
                f"scoreboard-year-{year}",
            )
            merged.extend(data.get("events") or [])
        ordered = regular_season_events(builder, merged)

    if len(ordered) != 552:
        raise RuntimeError(
            f"Expected 552 Championship regular-season fixtures, found {len(ordered)}. "
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

    # Each runner handles only ~46 summaries sequentially. This avoids hammering
    # ESPN and avoids sharing requests.Session across threads.
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

        selected = events[index::count]
        meta_rows = payload.get("meta") or []
        meta_by_id = {str(m.get("event_id") or ""): m for m in meta_rows}
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

    # Reuse the existing, already-tested aggregation and quality-gate logic without
    # performing any additional network requests.
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
