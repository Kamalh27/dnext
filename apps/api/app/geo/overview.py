"""National 'current conditions' overview from the two daily precomputes (no Earth Engine call).

Observed 30-day rainfall per tambon (GSMaP) vs the tambon's rainfall thresholds -> trigger class; with the static histogram that gives
risk, people in the elevated zone and class areas per tambon, aggregated to provinces. horizon_days > 0 swaps the last
`horizon_days` observed days for the GFS forecast of the next `horizon_days` days (same rule as the forecast scenario).
"""
import logging
import threading
import time

from app.geo import tambon_risk, obs_cache, static_stats
from app.settings import load_yaml

log = logging.getLogger("api")
_memo: dict = {}
_TTL_S = 3600          # results stay valid for an hour while the daily files are unchanged
FACILITY_CAP = 50        # most at-risk named facilities kept in the national result (for the report)
_MAX_STALE_S = 6 * 3600  # a stale result is still served (and refreshed in the background) for this long
_lock = threading.Lock()
_inflight: set = set()


def _sig(data: dict | None):
    """Identity of the daily file: a reload of an unchanged file must not throw the computed results away."""
    return None if not data else (data.get("newest_ms"), (data.get("forecast") or {}).get("run_ms"))


def _swr(key, compute):
    """Cached value while fresh. When it is stale, return it straight away and recompute once in the background, so a visitor after an
    idle period gets the map immediately. Compute inline only when there is nothing usable (first call, or too old)."""
    now, sig = time.time(), _sig(obs_cache.load())
    hit = _memo.get(key)
    if hit and now - hit[0] < _TTL_S and hit[2] == sig:
        return hit[1]
    if hit and now - hit[0] < _MAX_STALE_S:
        with _lock:
            start = key not in _inflight
            if start:
                _inflight.add(key)
        if start:
            def refresh():
                try:
                    compute()
                except Exception as e:  # noqa: BLE001
                    log.warning("overview refresh failed: %s", str(e)[:120])
                finally:
                    with _lock:
                        _inflight.discard(key)
            threading.Thread(target=refresh, daemon=True).start()
        return hit[1]
    return compute()


def warm() -> None:
    """Fill the caches (called at startup); failures only mean the first visitor computes it instead."""
    try:
        series(5)
        national(0)
    except Exception as e:  # noqa: BLE001
        log.info("overview warm-up skipped: %s", str(e)[:120])


class OverviewUnavailable(RuntimeError):
    pass


def _rows(data: dict, horizon: int) -> list[dict]:
    rows = []
    for code, t in data["tambon"].items():
        d = t["d"][: tambon_risk.cfg()["trigger"]["window_days"] - horizon]
        if any(v is None for v in d):
            rain = None
        else:
            rain = float(sum(d))
            if horizon:
                f = t.get("f") or []
                rain = rain + float(f[horizon - 1] or 0.0) if len(f) >= horizon else None
        rows.append({"adm3_pcode": code, "rain30_mm": rain, "trigger_class": tambon_risk.trigger_class(rain, t["thr"]), "pc": t["pc"], "p": t["p"], "pt": t["pt"],
                     "adm3_name": t.get("n", ""), "adm3_name1": t.get("nt", ""), "adm2_name": t.get("a", ""), "adm2_name1": t.get("at", ""),
                     "adm1_name": t["p"], "adm1_name1": t["pt"], "day_rain_mm": _day_rain(t, horizon)})
    return rows


def _day_rain(t: dict, h: int) -> float | None:
    """Rain on day h of the slider: h=0 -> the newest observed day; h>=1 -> the GFS increment for day h (forecast values are cumulative)."""
    if h == 0:
        v = (t.get("d") or [None])[0]
        return None if v is None else float(v)
    f = t.get("f") or []
    if len(f) < h or f[h - 1] is None:
        return None
    prev = float(f[h - 2]) if h > 1 and f[h - 2] is not None else 0.0
    return max(0.0, float(f[h - 1]) - prev)


def national(horizon_days: int = 0) -> dict:
    return _swr((horizon_days,), lambda: _national(horizon_days))


def _national(horizon_days: int) -> dict:
    key = (horizon_days,)
    src = tambon_risk.cfg()["trigger"]["observed_source"]
    data, ss = obs_cache.load(), static_stats.load()
    if not obs_cache.usable(data, src, tambon_risk.cfg()["trigger"]["window_days"]) or not ss:
        raise OverviewUnavailable("Daily rainfall precompute is missing or stale; run scripts/precompute_rain.py")
    f = (data.get("forecast") or {})
    if horizon_days and (str(horizon_days) not in {str(k) for k in f.get("horizons", {})} or time.time() * 1000 - f.get("run_ms", 0) > obs_cache.MAX_FORECAST_AGE_MS):
        raise OverviewUnavailable("No fresh GFS forecast in the precompute for this horizon")
    rows = _rows(data, horizon_days)
    prone = static_stats.prone_codes(ss)
    for r in rows:             # rain above a threshold on ground that cannot slide is not a landslide trigger: count it as none
        if r["adm3_pcode"] not in prone:
            r["rain_trigger_class"], r["trigger_class"] = r["trigger_class"], 0
    feats = static_stats.load_features()
    res = static_stats.tambon_stats(ss, [r for r in rows if r["adm3_pcode"] in ss["tambon"]], features=feats,
                                    footprint_m2=load_yaml("thresholds.yaml")["exposure"].get("avg_footprint_m2", 60.0))
    st = res["rows"]
    prov: dict[str, dict] = {}
    for r in rows:
        s = st.get(r["adm3_pcode"], {})
        p = prov.setdefault(r["pc"], {"pcode": r["pc"], "name": r["p"], "name_th": r["pt"], "tambons": 0, "triggered": 0, "max_trigger": 0,
                                      "people_elevated": 0.0, "risk_max": 0.0})
        p["tambons"] += 1
        if r.get("day_rain_mm") is not None:
            p["_rain_sum"] = p.get("_rain_sum", 0.0) + r["day_rain_mm"]
            p["_rain_n"] = p.get("_rain_n", 0) + 1
        p["triggered"] += r["trigger_class"] > 0
        p["max_trigger"] = max(p["max_trigger"], r["trigger_class"])
        p["people_elevated"] += s.get("people_high") or 0.0
        p["risk_max"] = max(p["risk_max"], s.get("risk_max") or 0.0)
        for k in ("buildings", "hospitals", "schools", "road_km"):          # inside the elevated zone; absent without the features precompute
            if s.get(k) is not None:
                p[k] = p.get(k, 0.0) + s[k]
    rk = tambon_risk.cfg()["risk"]
    fac = static_stats.facilities_at_risk(static_stats.load_facilities(), rows, rk["cutoffs"], rk["divisor"], rk["class_names"], rk["class_names_th"], prone)
    provinces = []
    for p in prov.values():
        p["triggered_share"] = round(p["triggered"] / p["tambons"], 3) if p["tambons"] else 0.0
        p["people_elevated"] = int(round(p["people_elevated"], -2))
        p["risk_max"] = round(p["risk_max"], 2)
        if "buildings" in p:
            p["buildings"], p["hospitals"], p["schools"], p["road_km"] = (int(round(p["buildings"], -1)), int(round(p["hospitals"])),
                                                                           int(round(p["schools"])), round(p["road_km"], 1))
        n = p.pop("_rain_n", 0)
        p["rain_mm"] = round(p.pop("_rain_sum", 0.0) / n, 1) if n else None      # province-mean rain for the slider day
        # 0 = nothing triggered (or no susceptible ground); 1..5 = the risk class of the province's peak risk. Drives the map colours.
        p["risk_class"] = tambon_risk.risk_class(p["risk_max"], tambon_risk.cfg()["risk"]["cutoffs"]) if p["triggered"] and p["risk_max"] > 0 else 0
        provinces.append(p)
    # Rank by RISK, not rainfall alone: flat lowland provinces can exceed their local rain thresholds with almost no landslide-prone ground.
    provinces.sort(key=lambda p: (-p["risk_max"], -p["people_elevated"], -p["triggered_share"], p["name"]))
    out = {
        "kind": "forecast" if horizon_days else "observed", "horizon_days": horizon_days,
        "facilities": fac["items"][:FACILITY_CAP], "facilities_named": {"hospitals": fac["hospitals"], "schools": fac["schools"]},
        "date_of_data": data["date_of_data"], "source": data["source"], "dataset": data["dataset"],
        "model_run_time": f.get("model_run_time") if horizon_days else None,
        "tambons_total": len(rows), "triggered": sum(r["trigger_class"] > 0 for r in rows),
        "high_trigger": sum(r["trigger_class"] >= 4 for r in rows),
        "provinces_triggered": sum(p["triggered"] > 0 for p in provinces), "provinces_total": len(provinces),
        "people_elevated": int(round(sum(p["people_elevated"] for p in provinces), -3)),
        "elevated": ({k: (int(round(sum(p[k] for p in provinces), -2)) if k == "buildings" else
                          round(sum(p[k] for p in provinces), 1) if k == "road_km" else int(sum(p[k] for p in provinces)))
                      for k in ("buildings", "hospitals", "schools", "road_km")} if feats else None),
        # people / buildings / ... on susceptible ground in tambons above trigger, by risk class (1 Very low .. 5 Very high)
        "classes": [{**c, "area_km2": round(c["area_km2"], 1), "people": int(round(c["people"], -2)),
                     **({k: (int(round(c[k], -1)) if k == "buildings" else round(c[k], 1) if k == "road_km" else int(round(c[k])))
                         for k in ("buildings", "hospitals", "schools", "road_km")} if feats else {})} for c in res["by_class"]],
        "trigger_classes": [sum(1 for r in rows if r["trigger_class"] == i) for i in range(6)],
        "provinces": provinces, "top": [p for p in provinces if p["risk_class"] > 0][:5],
        "limitations": ["Observed rainfall (GSMaP, last 30 days) compared with each tambon's rainfall thresholds; a screening estimate, not a forecast."
                        if not horizon_days else
                        "Observed rainfall plus GFS forecast compared with each tambon's rainfall thresholds; a screening estimate."],
    }
    _memo[key] = (time.time(), out, _sig(data))
    return out


def series(max_days: int = 5) -> dict:
    """The slider: day 0 (latest observed) .. max_days (cumulative forecast), one compact record per day, so the UI scrubs instantly.

    Risk is cumulative (observed window + forecast so far, compared with the tambon thresholds); rain_mm is that day's own rain.
    """
    return _swr(("series", max_days), lambda: _series(max_days))


def _series(max_days: int) -> dict:
    key = ("series", max_days)
    cur = obs_cache.load()
    days = []
    forecast_note = None
    for h in range(0, max_days + 1):
        try:
            o = _national(h)
        except OverviewUnavailable as e:
            if h == 0:
                raise                                   # no usable observed data: nothing honest to show
            forecast_note = str(e)                       # degrade: keep the observed day, drop the forecast days
            break
        days.append({
            "h": h, "date": _day_date(cur, h),
            "totals": {k: o[k] for k in ("tambons_total", "triggered", "high_trigger", "provinces_triggered", "provinces_total", "people_elevated")},
            "elevated": o["elevated"], "classes": o["classes"], "trigger_classes": o["trigger_classes"],
            "provinces": [{k: p[k] for k in ("pcode", "name", "name_th", "risk_class", "risk_max", "triggered", "tambons", "max_trigger", "people_elevated",
                                             "rain_mm", "triggered_share", "buildings", "hospitals", "schools", "road_km") if k in p}
                          for p in o["provinces"]],
            "top": [{k: p[k] for k in ("pcode", "name", "name_th", "risk_max", "risk_class", "triggered", "tambons", "people_elevated")} for p in o["top"]],
        })
    f = cur.get("forecast", {})
    out = {"date_of_data": cur["date_of_data"], "source": cur["source"], "model_run_time": f.get("model_run_time"), "max_days": max_days,
           "days": days, "forecast_available": forecast_note is None, "forecast_note": forecast_note,
           "limitations": ["Observed rainfall (GSMaP) plus GFS forecast compared with each tambon's rainfall thresholds. Forecast skill falls with lead time; "
                           "this is a screening estimate, not a forecast."]}
    _memo[key] = (time.time(), out, _sig(cur))
    return out


def _day_date(data: dict, h: int) -> str:
    from datetime import datetime, timedelta, timezone
    if h == 0:
        return data["date_of_data"]
    f = data.get("forecast") or {}
    run = datetime.fromtimestamp(f.get("run_ms", 0) / 1000, tz=timezone.utc)
    return (run + timedelta(days=h)).strftime("%Y-%m-%d")
