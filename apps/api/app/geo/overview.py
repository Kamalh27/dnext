"""National 'current conditions' overview from the two daily precomputes (no Earth Engine call).

Observed 30-day rainfall per tambon (GSMaP) vs the tambon's DMR thresholds -> trigger class; with the static histogram that gives
risk, people in the elevated zone and class areas per tambon, aggregated to provinces. horizon_days > 0 swaps the last
`horizon_days` observed days for the GFS forecast of the next `horizon_days` days (same rule as the forecast scenario).
"""
import time

from app.geo import dmr, obs_cache, static_stats

_memo: dict = {}
_TTL_S = 600


class OverviewUnavailable(RuntimeError):
    pass


def _rows(data: dict, horizon: int) -> list[dict]:
    rows = []
    for code, t in data["tambon"].items():
        d = t["d"][: dmr.cfg()["trigger"]["window_days"] - horizon]
        if any(v is None for v in d):
            rain = None
        else:
            rain = float(sum(d))
            if horizon:
                f = t.get("f") or []
                rain = rain + float(f[horizon - 1] or 0.0) if len(f) >= horizon else None
        rows.append({"adm3_pcode": code, "rain30_mm": rain, "trigger_class": dmr.trigger_class(rain, t["thr"]), "pc": t["pc"], "p": t["p"], "pt": t["pt"]})
    return rows


def national(horizon_days: int = 0) -> dict:
    key = (horizon_days,)
    hit = _memo.get(key)
    if hit and time.time() - hit[0] < _TTL_S and hit[2] == id(obs_cache.load()):
        return hit[1]
    src = dmr.cfg()["trigger"]["observed_source"]
    data, ss = obs_cache.load(), static_stats.load()
    if not obs_cache.usable(data, src, dmr.cfg()["trigger"]["window_days"]) or not ss:
        raise OverviewUnavailable("Daily rainfall precompute is missing or stale; run scripts/precompute_dmr_rain.py")
    f = (data.get("forecast") or {})
    if horizon_days and (str(horizon_days) not in {str(k) for k in f.get("horizons", {})} or time.time() * 1000 - f.get("run_ms", 0) > obs_cache.MAX_FORECAST_AGE_MS):
        raise OverviewUnavailable("No fresh GFS forecast in the precompute for this horizon")
    rows = _rows(data, horizon_days)
    st = static_stats.tambon_stats(ss, [r for r in rows if r["adm3_pcode"] in ss["tambon"]])["rows"]
    prov: dict[str, dict] = {}
    for r in rows:
        s = st.get(r["adm3_pcode"], {})
        p = prov.setdefault(r["pc"], {"pcode": r["pc"], "name": r["p"], "name_th": r["pt"], "tambons": 0, "triggered": 0, "max_trigger": 0,
                                      "people_elevated": 0.0, "risk_max": 0.0})
        p["tambons"] += 1
        p["triggered"] += r["trigger_class"] > 0
        p["max_trigger"] = max(p["max_trigger"], r["trigger_class"])
        p["people_elevated"] += s.get("people_high") or 0.0
        p["risk_max"] = max(p["risk_max"], s.get("risk_max") or 0.0)
    provinces = []
    for p in prov.values():
        p["triggered_share"] = round(p["triggered"] / p["tambons"], 3) if p["tambons"] else 0.0
        p["people_elevated"] = int(round(p["people_elevated"], -2))
        p["risk_max"] = round(p["risk_max"], 2)
        # 0 = nothing triggered (or no susceptible ground); 1..5 = the DMR risk class of the province's peak risk. Drives the map colours.
        p["risk_class"] = dmr.risk_class(p["risk_max"], dmr.cfg()["risk"]["cutoffs"]) if p["triggered"] and p["risk_max"] > 0 else 0
        provinces.append(p)
    # Rank by RISK, not rainfall alone: flat lowland provinces can exceed their local rain thresholds with almost no landslide-prone ground.
    provinces.sort(key=lambda p: (-p["risk_max"], -p["people_elevated"], -p["triggered_share"], p["name"]))
    out = {
        "kind": "forecast" if horizon_days else "observed", "horizon_days": horizon_days,
        "date_of_data": data["date_of_data"], "source": data["source"], "dataset": data["dataset"],
        "model_run_time": f.get("model_run_time") if horizon_days else None,
        "tambons_total": len(rows), "triggered": sum(r["trigger_class"] > 0 for r in rows),
        "high_trigger": sum(r["trigger_class"] >= 4 for r in rows),
        "provinces_triggered": sum(p["triggered"] > 0 for p in provinces), "provinces_total": len(provinces),
        "people_elevated": int(round(sum(p["people_elevated"] for p in provinces), -3)),
        "provinces": provinces, "top": [p for p in provinces if p["risk_class"] > 0][:5],
        "limitations": ["Observed rainfall (GSMaP, last 30 days) compared with each tambon's DMR thresholds; not an official warning or forecast."
                        if not horizon_days else
                        "Observed rainfall plus GFS forecast compared with each tambon's DMR thresholds; not an official warning."],
    }
    _memo[key] = (time.time(), out, id(data))
    return out
