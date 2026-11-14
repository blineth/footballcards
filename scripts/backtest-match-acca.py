#!/usr/bin/env python3
from __future__ import annotations
import csv, json, math, re, unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT=Path(__file__).resolve().parents[1]
INPUT=ROOT/"data"/"current-season"/"h2h.csv"
OUTPUT=ROOT/"data"/"model"/"match-acca-backtest.json"
COMPETITIONS={"Premier League","Championship","League One","League Two"}

def norm(v:str|None)->str:
    v=unicodedata.normalize("NFD",str(v or ""))
    v="".join(ch for ch in v if unicodedata.category(ch)!="Mn").casefold()
    return re.sub(r"[^a-z0-9]+"," ",v).strip()

def iv(r:dict[str,str],k:str)->int:
    try:return int(float(r.get(k) or 0))
    except:return 0

def clamp(v:float,a=.01,b=.99)->float:return max(a,min(b,v))
def points(r:str)->int:return 3 if r=="W" else 1 if r=="D" else 0

def fixture_key(r:dict[str,str])->tuple[str,str,str,str]:
    teams=sorted([norm(r.get("team")),norm(r.get("opponent"))])
    return (r.get("match_date") or "",r.get("competition") or "",teams[0],teams[1])

def team_key(date:str,team:str,opp:str)->tuple[str,str,str]:
    return (date,norm(team),norm(opp))

def build_team_matches(rows:list[dict[str,str]])->list[dict[str,Any]]:
    grouped:dict[tuple[str,str,str,str],dict[str,Any]]={}
    for r in rows:
        if (r.get("competition") or "") not in COMPETITIONS:continue
        date=r.get("match_date") or ""
        team=r.get("team") or ""
        opp=r.get("opponent") or ""
        if not date or not team or not opp:continue
        key=(date,r.get("competition") or "",team,opp)
        row=grouped.setdefault(key,{"date":date,"competition":r.get("competition") or "","team":team,"opponent":opp,"goals":0,"venue":(r.get("venue") or "").lower()})
        row["goals"]+=iv(r,"goals")
        if not row["venue"] and r.get("venue"):row["venue"]=(r.get("venue") or "").lower()
    lookup={(v["date"],norm(v["team"]),norm(v["opponent"])):v for v in grouped.values()}
    out=[]
    for v in grouped.values():
        o=lookup.get((v["date"],norm(v["opponent"]),norm(v["team"])))
        if not o:continue
        gf=int(v["goals"]);ga=int(o["goals"])
        out.append({**v,"gf":gf,"ga":ga,"result":"W" if gf>ga else "L" if gf<ga else "D","btts":gf>0 and ga>0})
    return out

def standings(hist:list[dict[str,Any]]):
    teams=sorted({r["team"] for r in hist})
    rows=[]
    for team in teams:
        ms=[r for r in hist if norm(r["team"])==norm(team)]
        gf=sum(r["gf"] for r in ms);ga=sum(r["ga"] for r in ms)
        rows.append((team,sum(points(r["result"]) for r in ms),gf-ga,gf))
    rows.sort(key=lambda x:(-x[1],-x[2],-x[3],x[0]))
    return {norm(team):i+1 for i,(team,*_) in enumerate(rows)},len(rows)

def streak(rows:list[dict[str,Any]])->str:
    if not rows:return "—"
    ordered=sorted(rows,key=lambda r:r["date"],reverse=True)
    first=ordered[0]["result"];n=0
    for r in ordered:
        if r["result"]!=first:break
        n+=1
    return first+str(n)

def metrics(team:str,hist:list[dict[str,Any]],positions:dict[str,int],team_count:int,venue:str):
    rows=sorted([r for r in hist if norm(r["team"])==norm(team)],key=lambda r:r["date"])
    recent=rows[-5:]
    split=[r for r in rows if r["venue"]==venue]
    def rate(xs,fn):return sum(1 for r in xs if fn(r))/len(xs) if xs else .5
    pts=sum(points(r["result"]) for r in rows);gf=sum(r["gf"] for r in rows);ga=sum(r["ga"] for r in rows)
    return {
        "position":positions.get(norm(team),team_count or 24),"teams":team_count or 24,"played":len(rows),
        "ppg":pts/len(rows) if rows else 1.2,"winRate":rate(rows,lambda r:r["result"]=="W"),
        "drawRate":rate(rows,lambda r:r["result"]=="D"),"lossRate":rate(rows,lambda r:r["result"]=="L"),
        "gd":gf-ga,"recentPPG":sum(points(r["result"]) for r in recent)/len(recent) if recent else 1.2,
        "streak":streak(rows),"venueWinRate":rate(split,lambda r:r["result"]=="W"),
        "venuePPG":sum(points(r["result"]) for r in split)/len(split) if split else 1.2,
        "venueBttsRate":rate(split,lambda r:r["btts"]),"venueScoreRate":rate(split,lambda r:r["gf"]>0),
        "venueConcedeRate":rate(split,lambda r:r["ga"]>0),"bttsRate":rate(rows,lambda r:r["btts"]),
    }

def h2h(home:str,away:str,hist:list[dict[str,Any]]):
    rows=sorted([r for r in hist if norm(r["team"])==norm(home) and norm(r["opponent"])==norm(away)],key=lambda r:r["date"],reverse=True)[:6]
    hw=sum(1 for r in rows if r["result"]=="W");d=sum(1 for r in rows if r["result"]=="D")
    return {"matches":len(rows),"homeWinRate":hw/len(rows) if rows else .5,"bttsRate":sum(1 for r in rows if r["btts"])/len(rows) if rows else .5}

def strength(m):
    pos=1-(m["position"]-1)/(m["teams"]-1) if m["teams"]>1 else .5
    gd=m["gd"]/m["played"] if m["played"] else 0
    gd_score=1/(1+math.exp(-gd*1.25))
    return pos*.25+(m["ppg"]/3)*.22+(m["recentPPG"]/3)*.22+(m["venuePPG"]/3)*.16+gd_score*.10+m["winRate"]*.05

def result_prob(home,away,hh):
    rel=clamp(min(home["played"],away["played"])/8,.25,1)
    diff=strength(home)-strength(away)+.055
    if hh["matches"]>=2:diff+=(hh["homeWinRate"]-.5)*min(.08,hh["matches"]*.012)
    for m,sign in ((home,1),(away,-1)):
        if m["streak"].startswith("W"):diff+=sign*min(.06,int(m["streak"][1:] or 0)*.012)
        if m["streak"].startswith("L"):diff-=sign*min(.06,int(m["streak"][1:] or 0)*.012)
    draw=clamp((home["drawRate"]+away["drawRate"])/2*.55+.11,.18,.34)
    share=1/(1+math.exp(-diff*4.2))
    hp=(1-draw)*share;ap=(1-draw)*(1-share);dp=draw
    hp=hp*rel+.42*(1-rel);dp=dp*rel+.28*(1-rel);ap=ap*rel+.30*(1-rel)
    total=hp+dp+ap
    return hp/total,dp/total,ap/total,rel

def btts_prob(home,away,hh):
    rel=clamp(min(home["played"],away["played"])/8,.25,1)
    scoring=((home["venueScoreRate"]*away["venueConcedeRate"])+(away["venueScoreRate"]*home["venueConcedeRate"]))/2
    p=home["venueBttsRate"]*.24+away["venueBttsRate"]*.24+home["bttsRate"]*.13+away["bttsRate"]*.13+scoring*.18+hh["bttsRate"]*.08
    return clamp(p*rel+.5*(1-rel),.16,.84)

def calibration_bands(rows:list[dict[str,Any]],prob_key:str,outcome_key:str):
    bins=[[] for _ in range(20)]
    for r in rows:
        p=float(r[prob_key]);bins[min(19,max(0,int(p/.05)))].append(r)
    raw=[];weights=[];meta=[]
    for i,xs in enumerate(bins):
        low=i*.05;mid=low+.025;n=len(xs);hits=sum(1 for r in xs if r[outcome_key])
        v=(hits+mid*25)/(n+25)
        raw.append(v);weights.append(max(1,n));meta.append({"from":round(low,2),"to":round(low+.05,2),"sample":n,"hits":hits,"observedRate":round(hits/n,4) if n else None})
    blocks=[{"s":i,"e":i,"v":raw[i],"w":weights[i]} for i in range(20)]
    i=0
    while i<len(blocks)-1:
        if blocks[i]["v"]<=blocks[i+1]["v"]:i+=1;continue
        w=blocks[i]["w"]+blocks[i+1]["w"]
        merged={"s":blocks[i]["s"],"e":blocks[i+1]["e"],"v":(blocks[i]["v"]*blocks[i]["w"]+blocks[i+1]["v"]*blocks[i+1]["w"])/w,"w":w}
        blocks[i:i+2]=[merged];i=max(0,i-1)
    vals=[0.0]*20
    for b in blocks:
        for j in range(b["s"],b["e"]+1):vals[j]=clamp(float(b["v"]))
    for i,v in enumerate(vals):meta[i]["calibratedProbability"]=round(v,4)
    return meta

def summary(rows:list[dict[str,Any]],pkey:str="model",okey:str="hit"):
    if not rows:return {"sample":0}
    hits=sum(1 for r in rows if r[okey]);avg=sum(float(r[pkey]) for r in rows)/len(rows)
    return {"sample":len(rows),"hits":hits,"hitRate":round(hits/len(rows),4),"avgModel":round(avg,4),"brier":round(sum((float(r[pkey])-(1 if r[okey] else 0))**2 for r in rows)/len(rows),5)}

def main():
    with INPUT.open(encoding="utf-8",newline="") as h:player_rows=list(csv.DictReader(h))
    matches=build_team_matches(player_rows)
    by_date=defaultdict(list)
    for r in matches:by_date[r["date"]].append(r)
    history=defaultdict(list)
    samples=[];structures={"fold5":[],"fold7":[],"fold10":[]}
    for date in sorted(by_date):
        day=by_date[date]
        fixtures={}
        for r in day:
            key=fixture_key({"match_date":r["date"],"competition":r["competition"],"team":r["team"],"opponent":r["opponent"]})
            fixtures.setdefault(key,[]).append(r)
        day_candidates=[]
        for key,rows in fixtures.items():
            comp=key[1]
            if comp not in COMPETITIONS:continue
            home=next((r for r in rows if r["venue"]=="home"),None)
            away=next((r for r in rows if r["venue"]=="away"),None)
            if not home or not away:continue
            hist=history[comp]
            positions,count=standings(hist)
            hm=metrics(home["team"],hist,positions,count,"home");am=metrics(away["team"],hist,positions,count,"away")
            if min(hm["played"],am["played"])<3:continue
            hh=h2h(home["team"],away["team"],hist)
            hp,dp,ap,rel=result_prob(hm,am,hh);bp=btts_prob(hm,am,hh)
            row={"competition":comp,"date":date,"home":home["team"],"away":away["team"],"homeP":hp,"awayP":ap,"bttsP":bp,"homeWin":home["result"]=="W","awayWin":away["result"]=="W","btts":bool(home["btts"])}
            samples.append(row)
            if hp>=.43 or ap>=.40:
                p=hp if hp>=ap else ap;hit=row["homeWin"] if hp>=ap else row["awayWin"]
                day_candidates.append({"fixture":key,"kind":"win","model":p,"hit":hit,"score":(p-.34)/.45})
            if bp>=.55 or bp<=.45:
                p=bp if bp>=.55 else 1-bp;hit=row["btts"] if bp>=.55 else not row["btts"]
                day_candidates.append({"fixture":key,"kind":"btts","model":p,"hit":hit,"score":(p-.5)/.34})
        ranked=sorted(day_candidates,key=lambda x:x["score"],reverse=True)
        unique=[]
        seen=set()
        for candidate in ranked:
            fixture=candidate["fixture"]
            if fixture in seen:
                continue
            seen.add(fixture)
            unique.append(candidate)
        for n,key in ((5,"fold5"),(7,"fold7"),(10,"fold10")):
            pool=unique[:n]
            if len(pool)==n:
                structures[key].append({"model":math.prod(x["model"] for x in pool),"hit":all(x["hit"] for x in pool)})
        for r in day:history[r["competition"]].append(r)
    output={
        "version":"match-acca-walk-forward-v1","source":"data/current-season/h2h.csv",
        "methodology":"Walk-forward English-league validation using only team results dated before each fixture. Probabilities use the same league position, PPG, recent form, venue split, goal-difference, streak and H2H structure as the live Accumulator model.",
        "markets":{
            "homeWin":summary([{"model":r["homeP"],"hit":r["homeWin"]} for r in samples]),
            "awayWin":summary([{"model":r["awayP"],"hit":r["awayWin"]} for r in samples]),
            "bttsYes":summary([{"model":r["bttsP"],"hit":r["btts"]} for r in samples]),
            "bttsNo":summary([{"model":1-r["bttsP"],"hit":not r["btts"]} for r in samples]),
        },
        "calibration":{
            "homeWin":{"bands":calibration_bands(samples,"homeP","homeWin")},
            "awayWin":{"bands":calibration_bands(samples,"awayP","awayWin")},
            "bttsYes":{"bands":calibration_bands(samples,"bttsP","btts")},
            "bttsNo":{"bands":calibration_bands([{**r,"noP":1-r["bttsP"],"no":not r["btts"]} for r in samples],"noP","no")},
        },
        "structures":{k:summary(v) for k,v in structures.items()},
    }
    OUTPUT.parent.mkdir(parents=True,exist_ok=True);OUTPUT.write_text(json.dumps(output,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"markets":output["markets"],"structures":output["structures"]},indent=2))
    return 0

if __name__=="__main__":raise SystemExit(main())
