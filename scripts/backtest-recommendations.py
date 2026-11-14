#!/usr/bin/env python3
"""Walk-forward backtest of the recommendation strategy.

This validates the selection/ranking logic using only information available
before each target match. It does not pretend historical bookmaker prices
were available when they were not.
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

ROOT=Path(__file__).resolve().parents[1]
INPUT=ROOT/"data"/"current-season"/"h2h.csv"
OUTPUT=ROOT/"data"/"model"/"recommendation-backtest.json"
MIN_MATCHES=4
MIN_MINUTES=240

def norm(v:str|None)->str:
    v=unicodedata.normalize("NFD",str(v or ""))
    v="".join(ch for ch in v if unicodedata.category(ch)!="Mn").casefold()
    return re.sub(r"[^a-z0-9]+"," ",v).strip()

def iv(row:dict[str,str],k:str)->int:
    try:return int(float(row.get(k) or 0))
    except:return 0

def bv(row:dict[str,str],k:str)->bool:
    return str(row.get(k) or "").strip().lower() in {"true","1","yes","y"}

def player_key(row:dict[str,str])->str:
    ext=str(row.get("external_player_id") or "").strip()
    return "id:"+ext if ext else "name:"+norm(row.get("player_name"))

def fixture_key(row:dict[str,str])->tuple[str,str,str,str]:
    team=norm(row.get("team")); opp=norm(row.get("opponent"))
    a,b=sorted([team,opp])
    return (row.get("match_date") or "",row.get("competition") or "Unknown",a,b)

def clamp(x:float,lo=.01,hi=.99)->float:return max(lo,min(hi,x))

def beta(h:int,n:int,p:float,s:float)->float:return (h+p*s)/(n+s)

def hit(rows:list[dict[str,str]],market:str)->int:
    if market=="card":return sum(1 for r in rows if bv(r,"yellow_card"))
    threshold=int(market.replace("foul",""))
    return sum(1 for r in rows if iv(r,"fouls_committed")>=threshold)

def prob(rows:list[dict[str,str]],market:str)->float:
    prior={"card":.22,"foul1":.70,"foul2":.38,"foul3":.17,"foul4":.055,"foul5":.018}[market]
    recent10=rows[-10:]; recent5=rows[-5:]
    allp=beta(hit(rows,market),len(rows),prior,6)
    ten=beta(hit(recent10,market),len(recent10),allp,5)
    five=beta(hit(recent5,market),len(recent5),ten,4)
    return clamp(allp*.48+ten*.27+five*.25)

def outcome(row:dict[str,str],market:str)->bool:
    if market=="card":return bv(row,"yellow_card")
    return iv(row,"fouls_committed")>=int(market.replace("foul",""))

def main()->int:
    with INPUT.open(encoding="utf-8",newline="") as h:
        rows=[r for r in csv.DictReader(h) if iv(r,"minutes")>0]
    rows.sort(key=lambda r:(r.get("match_date") or "",r.get("competition") or "",fixture_key(r),player_key(r)))

    history:dict[str,list[dict[str,str]]]=defaultdict(list)
    by_date:dict[str,list[dict[str,str]]]=defaultdict(list)
    for row in rows:by_date[row.get("match_date") or ""].append(row)

    picks:list[dict[str,Any]]=[]
    markets=("card","foul1","foul2","foul3","foul4","foul5")

    for date in sorted(by_date):
        day=by_date[date]
        fixtures:dict[tuple[str,str,str,str],list[dict[str,str]]]=defaultdict(list)
        for row in day:fixtures[fixture_key(row)].append(row)

        for key,fixture_rows in fixtures.items():
            candidates=[]
            for row in fixture_rows:
                hist=history[player_key(row)]
                minutes=sum(iv(r,"minutes") for r in hist)
                if len(hist)<MIN_MATCHES or minutes<MIN_MINUTES:continue
                for market in markets:
                    p=prob(hist,market)
                    # Prefer robust, repeatable lines. High thresholds need materially
                    # stronger evidence to outrank simple 1+ foul/card selections.
                    penalty={"card":0,"foul1":0,"foul2":.015,"foul3":.035,"foul4":.06,"foul5":.08}[market]
                    score=p-penalty
                    candidates.append((score,p,market,row))
            if candidates:
                candidates.sort(key=lambda x:(x[0],x[1]),reverse=True)
                _,p,market,row=candidates[0]
                picks.append({
                    "date":date,"competition":key[1],
                    "player":row.get("player_name") or "",
                    "team":row.get("team") or "",
                    "opponent":row.get("opponent") or "",
                    "market":market,"probability":round(p,4),
                    "outcome":1 if outcome(row,market) else 0,
                })
        # Only after all fixtures on the date are predicted do they enter history.
        for row in day:history[player_key(row)].append(row)

    def summary(sample:list[dict[str,Any]])->dict[str,Any]:
        if not sample:return {"sample":0,"hits":0,"hitRate":None,"avgProbability":None,"brier":None}
        hits=sum(int(r["outcome"]) for r in sample)
        return {
            "sample":len(sample),"hits":hits,"hitRate":round(hits/len(sample),4),
            "avgProbability":round(sum(float(r["probability"]) for r in sample)/len(sample),4),
            "brier":round(sum((float(r["probability"])-int(r["outcome"]))**2 for r in sample)/len(sample),5),
        }

    by_market={m:summary([r for r in picks if r["market"]==m]) for m in markets}
    by_comp={c:summary([r for r in picks if r["competition"]==c]) for c in sorted({r["competition"] for r in picks})}
    output={
        "version":"recommendation-walk-forward-v1",
        "source":"data/current-season/h2h.csv",
        "methodology":"One top model-ranked card/foul selection per historical fixture using only prior player matches. This validates ranking and hit-rate behaviour, not historical bookmaker profitability because historical exact prices are not available in the dataset.",
        "minimumPriorMatches":MIN_MATCHES,
        "minimumPriorMinutes":MIN_MINUTES,
        "overall":summary(picks),
        "byMarket":by_market,
        "byCompetition":by_comp,
        "recentPicks":picks[-100:],
    }
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    OUTPUT.write_text(json.dumps(output,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    print(json.dumps({"overall":output["overall"],"markets":by_market},indent=2))
    return 0

if __name__=="__main__":raise SystemExit(main())
