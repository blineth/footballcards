#!/usr/bin/env python3
"""Build walk-forward probability calibration for Match Edge.

Uses only information available before each target player-match row.
No target-match or future information is allowed into a prediction.

Output:
  data/model/calibration.json
"""

from __future__ import annotations

import csv
import json
import math
import re
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "data" / "current-season" / "h2h.csv"
OUTPUT = ROOT / "data" / "model" / "calibration.json"

MARKETS = ("foul1", "foul2", "foul3", "foul4", "foul5", "fouled1", "card", "shot1", "shot2", "sot1", "sot2")
PRIORS = {
    "foul1": 0.70,
    "foul2": 0.38,
    "foul3": 0.17,
    "foul4": 0.055,
    "foul5": 0.018,
    "fouled1": 0.62,
    "card": 0.22,
    "shot1": 0.62,
    "shot2": 0.36,
    "sot1": 0.34,
    "sot2": 0.12,
}
MIN_MATCHES = 4
MIN_MINUTES = 240
BIN_WIDTH = 0.05
COMPETITION_PRIOR_STRENGTH = 35.0
GLOBAL_PRIOR_STRENGTH = 18.0


def norm(value: str | None) -> str:
    value = unicodedata.normalize("NFD", str(value or ""))
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn").casefold()
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def to_int(row: dict[str, str], key: str) -> int:
    try:
        return int(float(row.get(key) or 0))
    except Exception:
        return 0


def to_bool(row: dict[str, str], key: str) -> bool:
    return str(row.get(key) or "").strip().lower() in {"true", "1", "yes", "y"}


def player_key(row: dict[str, str]) -> str:
    external = str(row.get("external_player_id") or "").strip()
    return "id:" + external if external else "name:" + norm(row.get("player_name"))


def played(row: dict[str, str]) -> bool:
    return to_int(row, "minutes") > 0


def hit(market: str, row: dict[str, str]) -> bool:
    if market == "foul1":
        return to_int(row, "fouls_committed") >= 1
    if market == "foul2":
        return to_int(row, "fouls_committed") >= 2
    if market == "foul3":
        return to_int(row, "fouls_committed") >= 3
    if market == "foul4":
        return to_int(row, "fouls_committed") >= 4
    if market == "foul5":
        return to_int(row, "fouls_committed") >= 5
    if market == "fouled1":
        return to_int(row, "fouls_drawn") >= 1
    if market == "card":
        return to_bool(row, "yellow_card")
    if market == "shot1":
        return to_int(row, "shots") >= 1
    if market == "shot2":
        return to_int(row, "shots") >= 2
    if market == "sot1":
        return to_int(row, "shots_on_target") >= 1
    return to_int(row, "shots_on_target") >= 2


def clamp(value: float, low: float = 0.01, high: float = 0.99) -> float:
    return max(low, min(high, value))


def beta_smoothed(hits: int, total: int, prior: float, strength: float = 6.0) -> float:
    return (hits + prior * strength) / (total + strength)


def hit_rate(rows: list[dict[str, str]], market: str) -> float:
    if not rows:
        return 0.0
    return sum(1 for row in rows if hit(market, row)) / len(rows)


def empirical_probability(rows: list[dict[str, str]], market: str) -> float:
    recent5 = rows[-5:]
    recent10 = rows[-10:]
    all_hits = sum(1 for row in rows if hit(market, row))
    all_rate = beta_smoothed(all_hits, len(rows), PRIORS[market], 6.0)
    ten_rate = beta_smoothed(sum(1 for row in recent10 if hit(market, row)), len(recent10), all_rate, 5.0)
    five_rate = beta_smoothed(sum(1 for row in recent5 if hit(market, row)), len(recent5), ten_rate, 4.0)
    return clamp(all_rate * 0.48 + ten_rate * 0.27 + five_rate * 0.25)


def per90(rows: list[dict[str, str]], key: str) -> float:
    minutes = sum(to_int(row, "minutes") for row in rows)
    total = sum(to_int(row, key) for row in rows)
    return total * 90.0 / minutes if minutes > 0 else 0.0


def poisson_at_least(lam: float, threshold: int) -> float:
    if lam <= 0:
        return 0.0
    cumulative = 0.0
    for k in range(threshold):
        cumulative += math.exp(-lam) * (lam**k) / math.factorial(k)
    return clamp(1.0 - cumulative)

def negative_binomial_at_least(mean: float, dispersion: float, threshold: int) -> float:
    if mean <= 0 or dispersion <= 0:
        return poisson_at_least(mean, threshold)
    r = dispersion
    p = r / (r + mean)
    cumulative = 0.0
    for k in range(threshold):
        log_p = (
            math.lgamma(k + r)
            - math.lgamma(r)
            - math.lgamma(k + 1)
            + r * math.log(p)
            + k * math.log(1.0 - p)
        )
        cumulative += math.exp(log_p)
    return clamp(1.0 - cumulative)


def foul_dispersion(rows: list[dict[str, str]]) -> float:
    values = [to_int(row, "fouls_committed") for row in rows]
    if len(values) < 6:
        return 20.0
    mean = sum(values) / len(values)
    variance = sum((v - mean) ** 2 for v in values) / max(1, len(values) - 1)
    if variance <= mean + 0.05:
        return 30.0
    return max(0.6, min(30.0, mean * mean / (variance - mean)))


def blend(base: float, other: float | None, weight: float) -> float:
    if other is None or weight <= 0:
        return base
    return clamp(base * (1.0 - weight) + other * weight)


def threshold_for_market(market: str) -> int:
    m = re.search(r"([1-9])$", market)
    return int(m.group(1)) if m else 1


def count_key(market: str) -> str | None:
    if market.startswith("foul") and not market.startswith("fouled"):
        return "fouls_committed"
    if market.startswith("fouled"):
        return "fouls_drawn"
    if market.startswith("sot"):
        return "shots_on_target"
    if market.startswith("shot"):
        return "shots"
    return None


def conditional_card(rows: list[dict[str, str]], predicate) -> tuple[int, int, float | None]:
    subset = [row for row in rows if predicate(to_int(row, "fouls_committed"))]
    if not subset:
        return 0, 0, None
    yellows = sum(1 for row in subset if to_bool(row, "yellow_card"))
    return len(subset), yellows, yellows / len(subset)


def card_behaviour(rows: list[dict[str, str]]) -> dict[str, Any]:
    overall_yellows = sum(1 for row in rows if to_bool(row, "yellow_card"))
    overall = overall_yellows / len(rows) if rows else PRIORS["card"]
    buckets = {
        "zero": conditional_card(rows, lambda f: f == 0),
        "exactly1": conditional_card(rows, lambda f: f == 1),
        "exactly2": conditional_card(rows, lambda f: f == 2),
        "threePlus": conditional_card(rows, lambda f: f >= 3),
        "onePlus": conditional_card(rows, lambda f: f >= 1),
        "twoPlus": conditional_card(rows, lambda f: f >= 2),
    }
    return {
        "overall": overall,
        "buckets": {
            key: {"matches": v[0], "yellows": v[1], "rate": v[2]}
            for key, v in buckets.items()
        },
    }


def raw_probability(history: list[dict[str, str]], market: str, opponent: str) -> float:
    probability = empirical_probability(history, market)

    h2h = [row for row in history if norm(row.get("opponent")) == norm(opponent)]
    if h2h:
        h2h_weight = min(0.18, len(h2h) / 30.0)
        probability = blend(probability, hit_rate(h2h, market), h2h_weight)

    key = count_key(market)
    if key:
        threshold = threshold_for_market(market)
        expected_minutes = max(35.0, min(90.0, sum(to_int(r, "minutes") for r in history[-10:]) / max(1, len(history[-10:]))))
        lam = per90(history, key) * expected_minutes / 90.0
        if lam > 0:
            poisson = poisson_at_least(lam, threshold)
            count_probability = (
                max(poisson, negative_binomial_at_least(lam, foul_dispersion(history), threshold))
                if market.startswith("foul") and not market.startswith("fouled")
                else poisson
            )
            count_weight = 0.42 if len(history) < 5 else 0.28 if len(history) < 10 else 0.18
            probability = blend(probability, count_probability, count_weight)

    if market == "card":
        behaviour = card_behaviour(history)
        overall = float(behaviour["overall"])
        foul1 = empirical_probability(history, "foul1")
        foul2 = empirical_probability(history, "foul2")
        foul3 = empirical_probability(history, "foul3")

        one = behaviour["buckets"]["onePlus"]
        two = behaviour["buckets"]["twoPlus"]
        exact2 = behaviour["buckets"]["exactly2"]
        three = behaviour["buckets"]["threePlus"]

        adjustments = [
            (one, foul1, 0.12, 10.0),
            (two, foul2, 0.28, 8.0),
            (exact2, max(0.0, foul2 - foul3), 0.18, 6.0),
            (three, foul3, 0.24, 5.0),
        ]
        for bucket, foul_probability, weight, reliability_matches in adjustments:
            rate = bucket["rate"]
            if rate is None:
                continue
            reliability = min(1.0, bucket["matches"] / reliability_matches)
            probability += (float(rate) - overall) * foul_probability * reliability * weight

        probability = clamp(probability)

    return probability


def brier(rows: list[dict[str, Any]], key: str) -> float | None:
    if not rows:
        return None
    return sum((float(row[key]) - float(row["outcome"])) ** 2 for row in rows) / len(rows)


def log_loss(rows: list[dict[str, Any]], key: str) -> float | None:
    if not rows:
        return None
    total = 0.0
    for row in rows:
        p = clamp(float(row[key]), 0.001, 0.999)
        y = float(row["outcome"])
        total += -(y * math.log(p) + (1.0 - y) * math.log(1.0 - p))
    return total / len(rows)


def bin_index(probability: float) -> int:
    return min(int(probability / BIN_WIDTH), int(1.0 / BIN_WIDTH) - 1)


def pav(values: list[float], weights: list[float]) -> list[float]:
    blocks = [{"start": i, "end": i, "value": values[i], "weight": max(1e-9, weights[i])} for i in range(len(values))]
    i = 0
    while i < len(blocks) - 1:
        if blocks[i]["value"] <= blocks[i + 1]["value"]:
            i += 1
            continue
        total_weight = blocks[i]["weight"] + blocks[i + 1]["weight"]
        merged = {
            "start": blocks[i]["start"],
            "end": blocks[i + 1]["end"],
            "value": (blocks[i]["value"] * blocks[i]["weight"] + blocks[i + 1]["value"] * blocks[i + 1]["weight"]) / total_weight,
            "weight": total_weight,
        }
        blocks[i:i + 2] = [merged]
        i = max(0, i - 1)

    result = [0.0] * len(values)
    for block in blocks:
        for idx in range(block["start"], block["end"] + 1):
            result[idx] = clamp(float(block["value"]))
    return result


def build_band_rows(predictions: list[dict[str, Any]], prior_bands: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    bins: list[list[dict[str, Any]]] = [[] for _ in range(int(1.0 / BIN_WIDTH))]
    for row in predictions:
        bins[bin_index(float(row["raw_probability"]))].append(row)

    raw_values: list[float] = []
    weights: list[float] = []
    metadata: list[dict[str, Any]] = []

    for idx, rows in enumerate(bins):
        low = idx * BIN_WIDTH
        high = low + BIN_WIDTH
        midpoint = low + BIN_WIDTH / 2.0
        n = len(rows)
        hits = sum(int(row["outcome"]) for row in rows)
        raw_mean = sum(float(row["raw_probability"]) for row in rows) / n if n else midpoint

        if prior_bands:
            prior = float(prior_bands[idx]["calibratedProbability"])
            strength = COMPETITION_PRIOR_STRENGTH
        else:
            prior = raw_mean
            strength = GLOBAL_PRIOR_STRENGTH

        calibrated = (hits + prior * strength) / (n + strength)
        raw_values.append(calibrated)
        weights.append(max(1.0, float(n)))
        metadata.append({
            "from": round(low, 2),
            "to": round(high, 2),
            "sample": n,
            "hits": hits,
            "rawMean": round(raw_mean, 4),
            "observedRate": round(hits / n, 4) if n else None,
        })

    monotonic = pav(raw_values, weights)
    for idx, value in enumerate(monotonic):
        metadata[idx]["calibratedProbability"] = round(value, 4)
    return metadata


def apply_bands(probability: float, bands: list[dict[str, Any]]) -> float:
    return float(bands[bin_index(probability)]["calibratedProbability"])


def expected_calibration_error(predictions: list[dict[str, Any]], bands: list[dict[str, Any]], key: str) -> float | None:
    if not predictions:
        return None
    total = 0.0
    for band in bands:
        low, high = float(band["from"]), float(band["to"])
        rows = [row for row in predictions if low <= float(row[key]) < high or (high >= 1.0 and float(row[key]) <= high)]
        if not rows:
            continue
        mean_p = sum(float(row[key]) for row in rows) / len(rows)
        observed = sum(int(row["outcome"]) for row in rows) / len(rows)
        total += len(rows) / len(predictions) * abs(mean_p - observed)
    return total


def metric_round(value: float | None) -> float | None:
    return None if value is None else round(value, 5)


def main() -> int:
    if not INPUT.exists():
        raise RuntimeError(f"Missing {INPUT}")

    with INPUT.open(encoding="utf-8", newline="") as handle:
        rows = [row for row in csv.DictReader(handle) if played(row)]

    rows.sort(key=lambda r: (r.get("match_date") or "", r.get("competition") or "", player_key(r)))
    history: dict[str, list[dict[str, str]]] = defaultdict(list)
    predictions: list[dict[str, Any]] = []

    for row in rows:
        key = player_key(row)
        prior = history[key]
        prior_minutes = sum(to_int(r, "minutes") for r in prior)
        if len(prior) >= MIN_MATCHES and prior_minutes >= MIN_MINUTES:
            opponent = row.get("opponent") or ""
            for market in MARKETS:
                raw = raw_probability(prior, market, opponent)
                predictions.append({
                    "competition": row.get("competition") or "Unknown",
                    "market": market,
                    "raw_probability": raw,
                    "outcome": 1 if hit(market, row) else 0,
                })
        prior.append(row)

    by_market: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_comp_market: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for prediction in predictions:
        by_market[prediction["market"]].append(prediction)
        by_comp_market[(prediction["competition"], prediction["market"])].append(prediction)

    global_output: dict[str, Any] = {}
    global_bands: dict[str, list[dict[str, Any]]] = {}
    for market in MARKETS:
        sample = by_market.get(market, [])
        bands = build_band_rows(sample)
        global_bands[market] = bands
        enriched = [{**row, "calibrated_probability": apply_bands(float(row["raw_probability"]), bands)} for row in sample]
        global_output[market] = {
            "sample": len(sample),
            "hits": sum(int(row["outcome"]) for row in sample),
            "baseRate": round(sum(int(row["outcome"]) for row in sample) / len(sample), 4) if sample else None,
            "brierRaw": metric_round(brier(sample, "raw_probability")),
            "brierCalibrated": metric_round(brier(enriched, "calibrated_probability")),
            "logLossRaw": metric_round(log_loss(sample, "raw_probability")),
            "logLossCalibrated": metric_round(log_loss(enriched, "calibrated_probability")),
            "eceRaw": metric_round(expected_calibration_error(sample, build_band_rows(sample), "raw_probability")),
            "bands": bands,
        }

    competitions = sorted({prediction["competition"] for prediction in predictions})
    comp_output: dict[str, Any] = {}
    for competition in competitions:
        market_output: dict[str, Any] = {}
        for market in MARKETS:
            sample = by_comp_market.get((competition, market), [])
            bands = build_band_rows(sample, global_bands[market])
            enriched = [{**row, "calibrated_probability": apply_bands(float(row["raw_probability"]), bands)} for row in sample]
            market_output[market] = {
                "sample": len(sample),
                "hits": sum(int(row["outcome"]) for row in sample),
                "baseRate": round(sum(int(row["outcome"]) for row in sample) / len(sample), 4) if sample else None,
                "brierRaw": metric_round(brier(sample, "raw_probability")),
                "brierCalibrated": metric_round(brier(enriched, "calibrated_probability")),
                "logLossRaw": metric_round(log_loss(sample, "raw_probability")),
                "logLossCalibrated": metric_round(log_loss(enriched, "calibrated_probability")),
                "bands": bands,
            }
        comp_output[competition] = market_output

    output = {
        "version": "walk-forward-v3",
        "source": "data/current-season/h2h.csv",
        "methodology": (
            "Walk-forward only. Each player-match prediction uses only that player's earlier rows. "
            "Minimum 4 earlier appearances and 240 earlier minutes. Five-percentage-point calibration "
            "bands are monotonically smoothed; competition bands shrink toward global market bands. "
            "Foul count thresholds use a negative-binomial/Poisson cross-check for over-dispersed player counts."
        ),
        "model": {
            "markets": list(MARKETS),
            "minimumPriorMatches": MIN_MATCHES,
            "minimumPriorMinutes": MIN_MINUTES,
            "binWidth": BIN_WIDTH,
            "cardBehaviour": (
                "Card probability uses player-specific booking rates at 1+ fouls, 2+ fouls, exactly 2 fouls "
                "and 3+ fouls, weighted by the probability of reaching those foul states and by sample reliability."
            ),
        },
        "rowsRead": len(rows),
        "walkForwardPredictions": len(predictions),
        "global": global_output,
        "competitions": comp_output,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    summary = {
        "rowsRead": len(rows),
        "walkForwardPredictions": len(predictions),
        "competitions": len(competitions),
        "markets": {
            market: {
                "sample": global_output[market]["sample"],
                "baseRate": global_output[market]["baseRate"],
                "brierRaw": global_output[market]["brierRaw"],
                "brierCalibrated": global_output[market]["brierCalibrated"],
            }
            for market in MARKETS
        },
    }
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
