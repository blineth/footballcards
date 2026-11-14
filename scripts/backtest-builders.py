#!/usr/bin/env python3
"""Walk-forward structural backtest for Match Edge bet-builder strategies.

Historical exact bookmaker prices are not available in the H2H dataset, so this
tests model selection structures and hit rates, not realised betting ROI.
"""

from __future__ import annotations
import csv, json, math, re, unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT=Path(__file__).resolve().parents[1]
INPUT=ROOT/"data"/"current-season"/"h2h.csv"
CALIBRATION=ROOT/"data"/"model"/"calibration.json"
OUTPUT=ROOT/"data"/"model"/"builder-backtest.json"
MIN_MATCHES=4
MIN_MINUTES=240

TARGETS=[
    {"id":"3/1","decimal":4.0,"min":0.66},
    {"id":"10/1","decimal":11.0,"min":0.60},
    {"id":"20/1","decimal":21.0,"min":0.55},
    {"id":"50/1","decimal":51.0,"min":0.48},
    {"id":"100/1","decimal":101.0,"min":0.42},
]
MARKETS=("card","foul1","foul2","foul3","foul4","foul5")
PRIORS={"card":.22,"foul1":.70,"foul2":.38,"foul3":.17,"foul4":.055,"foul5":.018}

def norm(v:str|None)->str:
    v=unicodedata.normalize("NFD",str(v or ""))
    v="".join(ch for ch in v if unicodedata.category(ch)!="Mn").casefold()
    return re.sub(r"[^a-z0-9]+"," ",v).strip()

def iv(r:dict[str,str],k:str)->int:
    try:return int(float(r.get(k) or 0))
    except:return 0

def bv(r:dict[str,str],k:str)->bool:
    return str(r.get(k) or "").strip().lower() in {"true","1","yes","y"}

def player_key(r:dict[str,str])->str:
    ext=str(r.get("external_player_id") or "").strip()
    return "id:"+ext if ext else "name:"+norm(r.get("player_name"))

def fixture_key(r:dict[str,str])->tuple[str,str,str,str]:
    teams=sorted([norm(r.get("team")),norm(r.get("opponent"))])
    return (r.get("match_date") or "",r.get("competition") or "Unknown",teams[0],teams[1])

def clamp(x:float,lo=.01,hi=.99)->float:return max(lo,min(hi,x))
def beta(h:int,n:int,p:float,s:float)->float:return (h+p*s)/(n+s)

def outcome(r:dict[str,str],market:str)->bool:
    if market=="card":return bv(r,"yellow_card")
    return iv(r,"fouls_committed")>=int(market.replace("foul",""))

def empirical(hist:list[dict[str,str]],market:str)->float:
    prior=PRIORS[market]
    r10=hist[-10:];r5=hist[-5:]
    def hits(rows):return sum(1 for r in rows if outcome(r,market))
    allp=beta(hits(hist),len(hist),prior,6)
    ten=beta(hits(r10),len(r10),allp,5)
    five=beta(hits(r5),len(r5),ten,4)
    return clamp(allp*.48+ten*.27+five*.25)

def poisson_at_least(lam:float,t:int)->float:
    if lam<=0:return 0.0
    return clamp(1-sum(math.exp(-lam)*(lam**k)/math.factorial(k) for k in range(t)))

def negbin_at_least(mean:float,disp:float,t:int)->float:
    if mean<=0:return 0.0
    r=max(.6,disp);p=r/(r+mean)
    cumulative=0.0
    for k in range(t):
        lp=math.lgamma(k+r)-math.lgamma(r)-math.lgamma(k+1)+r*math.log(p)+k*math.log(1-p)
        cumulative+=math.exp(lp)
    return clamp(1-cumulative)

def foul_dispersion(hist:list[dict[str,str]])->float:
    vals=[iv(r,"fouls_committed") for r in hist]
    if len(vals)<6:return 20.0
    m=sum(vals)/len(vals)
    var=sum((v-m)**2 for v in vals)/max(1,len(vals)-1)
    if var<=m+.05:return 30.0
    return max(.6,min(30,m*m/(var-m)))

def raw_prob(hist:list[dict[str,str]],market:str)->float:
    p=empirical(hist,market)
    if market.startswith("foul"):
        threshold=int(market.replace("foul",""))
        mins=sum(iv(r,"minutes") for r in hist[-8:])/max(1,len(hist[-8:]))
        total_mins=sum(iv(r,"minutes") for r in hist)
        per90=(sum(iv(r,"fouls_committed") for r in hist)*90/total_mins) if total_mins else 0
        mean=per90*max(35,min(90,mins))/90
        count=max(poisson_at_least(mean,threshold),negbin_at_least(mean,foul_dispersion(hist),threshold))
        weight=.42 if len(hist)<5 else .28 if len(hist)<10 else .18
        p=clamp(p*(1-weight)+count*weight)
    return p

def calibrated(raw:float,competition:str,market:str,cal:dict[str,Any])->float:
    source=cal.get("competitions",{}).get(competition,{}).get(market) or cal.get("global",{}).get(market)
    bands=(source or {}).get("bands") or []
    if len(bands)!=20:return raw
    idx=max(0,min(19,int(clamp(raw,0,.999999)/.05)))
    return float(bands[idx]["calibratedProbability"])

def likely_price(p:float,margin=1.075)->float:
    implied=min(.985,p*margin)
    raw=1/implied
    step=.01 if raw<2 else .02 if raw<4 else .05 if raw<8 else .1
    return max(1.01,round(raw/step)*step)

def summary(rows:list[dict[str,Any]])->dict[str,Any]:
    if not rows:return {"sample":0}
    hits=sum(int(r["hit"]) for r in rows)
    avgp=sum(float(r["model"]) for r in rows)/len(rows)
    return {
        "sample":len(rows),"hits":hits,"hitRate":round(hits/len(rows),4),
        "avgModel":round(avgp,4),
        "brier":round(sum((float(r["model"])-int(r["hit"]))**2 for r in rows)/len(rows),5),
    }

def beam_builder(candidates:list[dict[str,Any]],target:dict[str,Any])->dict[str,Any]|None:
    candidates=[c for c in candidates if c["p"]>=target["min"]]
    candidates.sort(key=lambda x:(x["p"],x["edge_proxy"]),reverse=True)
    states=[{"legs":[],"price":1.0,"quality":0.0,"players":set()}]
    for leg in candidates:
        nxt=list(states)
        for s in states:
            if len(s["legs"])>=12 or leg["player"] in s["players"]:continue
            price=s["price"]*leg["price"]
            if price>target["decimal"]*2.5 and len(s["legs"])>=2:continue
            nxt.append({
                "legs":s["legs"]+[leg],"price":price,
                "quality":s["quality"]+leg["p"]+max(0,leg["edge_proxy"])*.2,
                "players":set(s["players"])|{leg["player"]},
            })
        def score(s):
            if not s["legs"]:return 999
            dist=abs(math.log(max(1.01,s["price"]))-math.log(target["decimal"]))
            avg=s["quality"]/len(s["legs"])
            return dist*1.8-avg*.45
        states=sorted(nxt,key=score)[:180]
    usable=[s for s in states if len(s["legs"])>=2]
    if not usable:return None
    return min(usable,key=lambda s:abs(math.log(s["price"])-math.log(target["decimal"])))

def main()->int:
    cal=json.loads(CALIBRATION.read_text(encoding="utf-8"))
    with INPUT.open(encoding="utf-8",newline="") as h:
        rows=[r for r in csv.DictReader(h) if iv(r,"minutes")>0]
    rows.sort(key=lambda r:(r.get("match_date") or "",fixture_key(r),player_key(r)))

    history:dict[str,list[dict[str,str]]]=defaultdict(list)
    dates:dict[str,list[dict[str,str]]]=defaultdict(list)
    for r in rows:dates[r.get("match_date") or ""].append(r)

    market_rows={m:[] for m in MARKETS}
    target_rows={t["id"]:[] for t in TARGETS}
    card2=[];card3=[]
    multi3=[];multi5=[]

    for date in sorted(dates):
        day=dates[date]
        fixtures:dict[tuple[str,str,str,str],list[dict[str,str]]]=defaultdict(list)
        for r in day:fixtures[fixture_key(r)].append(r)
        day_best_fouls=[]

        for fk,frs in fixtures.items():
            candidates=[]
            for row in frs:
                hist=history[player_key(row)]
                if len(hist)<MIN_MATCHES or sum(iv(x,"minutes") for x in hist)<MIN_MINUTES:continue
                comp=fk[1]
                player=player_key(row)
                for market in MARKETS:
                    p=calibrated(raw_prob(hist,market),comp,market,cal)
                    hit=outcome(row,market)
                    market_rows[market].append({"model":p,"hit":hit})
                    if market.startswith("foul"):
                        price=likely_price(p)
                        candidates.append({
                            "player":player,"market":market,"p":p,"price":price,
                            "hit":hit,"edge_proxy":p-1/price,
                        })

            # target foul builders
            for target in TARGETS:
                built=beam_builder(candidates,target)
                if not built:continue
                legs=built["legs"]
                all_hit=all(bool(l["hit"]) for l in legs)
                model=math.prod(float(l["p"]) for l in legs)
                target_rows[target["id"]].append({
                    "hit":all_hit,"model":model,"legs":len(legs),"referencePrice":built["price"],
                })

            # cards: strongest two / three calibrated card candidates
            cards=[]
            for row in frs:
                hist=history[player_key(row)]
                if len(hist)<MIN_MATCHES or sum(iv(x,"minutes") for x in hist)<MIN_MINUTES:continue
                p=calibrated(raw_prob(hist,"card"),fk[1],"card",cal)
                cards.append((p,outcome(row,"card")))
            cards.sort(reverse=True,key=lambda x:x[0])
            if len(cards)>=2:
                legs=cards[:2];card2.append({"hit":all(x[1] for x in legs),"model":math.prod(x[0] for x in legs)})
            if len(cards)>=3:
                legs=cards[:3];card3.append({"hit":all(x[1] for x in legs),"model":math.prod(x[0] for x in legs)})

            fouls=[c for c in candidates if c["market"]=="foul1"]
            if fouls:
                best=max(fouls,key=lambda x:x["p"])
                day_best_fouls.append(best)

        # cross-match structure: top one 1+ foul per fixture
        day_best_fouls.sort(key=lambda x:x["p"],reverse=True)
        for n,bucket in [(3,multi3),(5,multi5)]:
            if len(day_best_fouls)>=n:
                legs=day_best_fouls[:n]
                bucket.append({"hit":all(bool(x["hit"]) for x in legs),"model":math.prod(float(x["p"]) for x in legs)})

        for r in day:history[player_key(r)].append(r)

    output={
        "version":"builder-walk-forward-v1",
        "source":"data/current-season/h2h.csv",
        "methodology":"Walk-forward structural validation using only prior player rows and the live calibration snapshot. Historical exact bookmaker prices are unavailable, so foul target builders use margin-adjusted likely prices solely to test selection structure. All-hit model products are independence guides and not same-game bookmaker quotes.",
        "markets":{m:summary(market_rows[m]) for m in MARKETS},
        "cardBuilders":{"twoCard":summary(card2),"threeCard":summary(card3)},
        "foulTargetBuilders":{
            k:{
                **summary(v),
                "avgLegs":round(sum(r["legs"] for r in v)/len(v),2) if v else None,
                "avgReferencePrice":round(sum(r["referencePrice"] for r in v)/len(v),2) if v else None,
            } for k,v in target_rows.items()
        },
        "multiMatch":{
            "threeMatchesOneFoulEach":summary(multi3),
            "fiveMatchesOneFoulEach":summary(multi5),
        },
    }
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    OUTPUT.write_text(json.dumps(output,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    print(json.dumps(output,indent=2))
    return 0

if __name__=="__main__":raise SystemExit(main())
