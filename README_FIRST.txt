FOOTBALL CARDS — FULL 2025/26 PLAYER CARD ENRICHMENT

This is the full-season version of the check that identified James Garner's bookings.

WHAT IT DOES
- Fetches Premier League GW1 through GW38 from FPL-Core-Insights.
- Reads every card incident.
- Joins each identified card by EXACT match_id + player_id.
- Processes all 12,613 player-match H2H rows, not just this week's fixtures.
- Writes yellow_card as 1 or 0 when known.
- Writes red_card as 1 or 0 when known.
- yellowRed is treated as both a yellow and a red.
- If a card is known to have happened but the upstream source cannot identify the player, it leaves the affected field blank/NULL rather than falsely writing 0.
- Regenerates player × referee history with exact card counts.
- Regenerates referee totals including red cards and fouls/game.
- Writes an audit file of every identified card incident and every unresolved card incident.

GENERATED FILES
- h2h.csv
- referees.csv
- player_referee_history.csv
- data/identified_card_events.csv
- data/unresolved_card_events.csv
- data/research-data-quality.json

INPUTS INCLUDED
- player_baselines.csv — current 565-row importer-compatible baseline.
- data/source/player_match_log_2025_26.json — all 12,613 player-match rows across 380 Premier League games.

HOW TO RUN IT
Upload the contents of this package to the ROOT of blineth/footballcards and commit to main.

The included GitHub Action runs automatically because these paths changed.
It has internet access, fetches all 38 gameweeks, builds the files, validates h2h.csv has exactly 12,613 rows, then commits the generated CSVs back into the repo.

IMPORTANT ABOUT YOUR CURRENT NEON DATABASE
You have ALREADY imported the earlier 12,613-row H2H file.
Your current H2H importer inserts rows and does not have a unique upsert guard.
DO NOT simply import the new h2h.csv on top of the existing H2H rows or you may create duplicates.

Once this full file has been generated, the next code change should make H2H import REPLACE/UPDATE the existing 2025/26 Premier League H2H records before you upload it.

After that, the dashboard can remove all temporary hard-coded H2H yellow-card overrides and read the yellow/red history directly from Neon.
