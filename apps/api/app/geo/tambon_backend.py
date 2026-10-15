"""Tambon-level landslide-risk backend: same public functions as ee_backend (hazard_scenario, exposure, forecast_hazard, explain).

Scenario rainfall semantics (to be confirmed): a what-if of X mm over D hours is ADDED to the observed rainfall of the
preceding (30 - ceil(D/24)) days, giving the 30-day total that the tambon thresholds are defined on.
Forecast: observed (30 - H) days + GFS accumulated forecast for the next H days.
"""
import logging
import math
import threading
import time

import ee

from app.geo import tambon_risk, obs_cache, rain, static_stats
from app.geo.ee_backend import _aoi, round_buildings, round_people
from app.geo.ee_init import get_info, init
from app.settings import assets, load_yaml

log = logging.getLogger(__name__)
_MEMO: dict = {}
_LOCK = threading.Lock()
_BUNDLE_TTL_S = 600
_OBS_TTL_S = 3600
RANK_N = 10
FACILITY_CAP = 200          # most at-risk named facilities kept in a result (markers, table and report)


def _memo(key, ttl, fn):
    now = time.time()
    with _LOCK:
        hit = _MEMO.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    val = fn()
    with _LOCK:
        _MEMO[key] = (now, val)
    return val


def _min_high_from(min_class: str) -> int:
    """Risk class from which people/area are counted. Risk classes are national and relative, so the generic min_class ('High'
    by default) is mapped to the configured 'elevated' class (risk >= 2) unless the caller asks for 'Very High'."""
    return 5 if min_class == "Very High" else tambon_risk.cfg()["risk"]["exposure_from"]


def _area_key(area) -> tuple:
    return (getattr(area, "level", None), getattr(area, "pcode", None) or getattr(area, "admin_code", None), tuple(round(x, 3) for x in area.bbox))


def _observed(area, region, fc, days: int):
    """(observed image, meta, cached per-tambon observed means)."""
    src = tambon_risk.cfg()["trigger"]["observed_source"]
    data = obs_cache.load()
    if obs_cache.usable(data, src, days):                     # fast path: daily precompute, no rainfall reduction
        rows = obs_cache.observed_rows(data, area, days)
        if rows:
            img, meta = rain.observed_image(days, src, newest_ms=data["newest_ms"])
            return img, {**meta, "from_cache": True}, rows
    img, meta = rain.observed_image(days, src)                # live Earth Engine
    rows = _memo(("obs", _area_key(area), days, src, meta["newest_ms"]), _OBS_TTL_S, lambda: tambon_risk.tambon_mean_rows(fc, img))
    return img, meta, rows


def _compute(area, extra_mm: float, window_obs_days: int, forecast: tuple | None, min_class: str) -> dict:
    """Everything one scenario needs, computed once and shared by hazard_scenario() and exposure()."""
    key = ("bundle", _area_key(area), round(extra_mm, 1), window_obs_days, forecast and forecast[0], _min_high_from(min_class), time.strftime("%Y%m%d"))

    def build():
        init()
        region = _aoi(area)
        fc = tambon_risk.tambons(region, area)
        obs_img, meta, obs_rows = _observed(area, region, fc, window_obs_days)
        add_by_code, rain_img, fmeta = None, obs_img.add(ee.Image(extra_mm)), None
        if forecast:
            f_img, fmeta = rain.gfs_forecast_image(forecast[0])
            data = obs_cache.load()
            cached = (obs_cache.forecast_means(data, area, forecast[0])
                      if data and data.get("forecast", {}).get("model_run_time") == fmeta["model_run_time"] else None)   # same GFS run only
            if cached:
                add_by_code = cached
            else:
                f_rows = tambon_risk.tambon_mean_rows(fc, f_img)
                add_by_code = {r["adm3_pcode"]: (r["mean"] or 0.0) for r in f_rows}
            rain_img = obs_img.add(f_img)
        rows = tambon_risk.classify_rows(obs_rows, extra_mm, add_by_code)
        tfc = tambon_risk.with_trigger(fc, rows)
        trig = tambon_risk.trigger_raster(tfc)
        ss = static_stats.load()
        if static_stats.covers(ss, rows):        # fast path: histogram precompute, no Earth Engine call
            r = tambon_risk.cfg()["risk"]
            stats = static_stats.tambon_stats(ss, rows, r["cutoffs"][_min_high_from(min_class) - 2], features=static_stats.load_features(),
                                             footprint_m2=load_yaml("thresholds.yaml")["exposure"].get("avg_footprint_m2", 60.0))
        else:
            stats = tambon_risk.tambon_stats(tfc, trig, tambon_risk.worldpop(), region, high_from=_min_high_from(min_class))
        sid = f"{area.admin_code}-{int(extra_mm)}-{window_obs_days}"
        prone = static_stats.prone_codes(ss) if static_stats.covers(ss, rows) else None
        if prone is not None:      # the risk layer leaves out tambons without landslide-prone ground, like the statistics do
            trig_risk = tambon_risk.trigger_raster(tambon_risk.with_trigger(fc, [{**r, "trigger_class": r["trigger_class"] if r["adm3_pcode"] in prone else 0} for r in rows]))
        else:
            trig_risk = trig
        layers = tambon_risk.build_layers(region, rain_img, trig, tambon_risk.risk_image(trig_risk), sid)
        rk = tambon_risk.cfg()["risk"]
        facilities = static_stats.facilities_at_risk(static_stats.load_facilities(), rows, rk["cutoffs"], rk["divisor"], rk["class_names"], rk["class_names_th"], prone)
        return {"meta": meta, "fmeta": fmeta, "rows": rows, "stats": stats, "layers": layers, "region_days": window_obs_days, "facilities": facilities, "prone": prone}

    return _memo(key, _BUNDLE_TTL_S, build)


# ---------------- shaping (pure, unit-tested) ----------------
NO_FEATURES = "Buildings, roads and facilities are not part of the risk layers and are not reported in this mode."
FEATURE_LIMITS = [
    "Buildings are estimated from the GHSL 2020 built-up surface (100 m) divided by an average footprint of 60 m2; hospitals, schools and main roads "
    "(motorway to tertiary) come from OpenStreetMap, which can be incomplete. All counts are for the Moderate-or-higher risk zone.",
]


def household_size() -> float:
    return load_yaml("thresholds.yaml")["exposure"]["household_size"]


def tambon_table(rows: list[dict], stats_rows: dict, n: int = RANK_N) -> list[dict]:
    """Merge trigger rows with per-tambon statistics and rank (people in high-risk area, then peak risk, then rainfall)."""
    merged = []
    for r in rows:
        s = stats_rows.get(r["adm3_pcode"], {})
        merged.append({
            "admin_code": r["adm3_pcode"], "name": r["adm3_name"], "name_th": r["adm3_name1"],
            "amphoe": r["adm2_name"], "amphoe_th": r["adm2_name1"], "province": r["adm1_name"],
            "trigger_class": r["trigger_class"],
            "rain30_mm": None if r["rain30_mm"] is None else round(r["rain30_mm"]),
            "risk_mean": None if s.get("risk") is None else round(s["risk"], 2),
            "risk_max": None if s.get("risk_max") is None else round(s["risk_max"], 2),
            "share_high_pct": None if s.get("share_high") is None else round(100 * s["share_high"], 1),
            "exposure_class": None if s.get("expo_class") is None else round(s["expo_class"], 1),
            "people": None if s.get("people_high") is None else round_people(s["people_high"]),
            # features in the elevated zone (None when the features precompute is not built)
            "buildings": None if s.get("buildings") is None else round_buildings(s["buildings"]),
            "hospitals": None if s.get("hospitals") is None else int(round(s["hospitals"])),
            "schools": None if s.get("schools") is None else int(round(s["schools"])),
            "road_km": None if s.get("road_km") is None else round(s["road_km"], 1),
        })
    merged.sort(key=lambda m: (-(m["people"] or 0), -(m["risk_max"] or 0), -(m["rain30_mm"] or 0)))
    return merged[:n]


def _sources(extra: list[str] | None = None) -> list[str]:
    """Descriptive names only: the Earth Engine paths of the ADPC layers are project-specific and stay server-side."""
    return ["Landslide susceptibility map (ADPC)", "Vulnerability index (ADPC)", "Exposure index (ADPC)",
            "Tambon rainfall thresholds (ADPC)", "WorldPop/GP/100m/pop (2020)"] + (extra or [])


def limitations(meta: dict, extra: list[str] | None = None) -> list[str]:
    t = tambon_risk.cfg()["trigger"]
    out = [
        "Screening-level estimate of rainfall-triggered landslide risk at tambon level; not a forecast.",
        "Risk = trigger x susceptibility x vulnerability x exposure / 125, on 1-5 classes; classes are relative, not probabilities.",
        f"Trigger compares each tambon's 30-day rainfall with its own percentile thresholds (P60-P95); rainfall is assumed uniform within a what-if scenario.",
        "Susceptibility is a static 12 m map; vulnerability and exposure are national indices. Tambon statistics are computed at ~100 m.",
        "People are WorldPop 2020 living where the risk class is Moderate or higher (risk >= 2; rounded); households are an estimate.",
    ]
    if meta.get("source") == "imerg":
        out.append("Observed rainfall is NASA IMERG; the rainfall thresholds were derived from JAXA GSMaP, so classes may be biased slightly high or low.")
    return out + (extra or [])


def _payload_common(b: dict) -> dict:
    meta = b["meta"]
    return {"date_of_data": meta["date_of_data"], "data_sources": _sources([meta["dataset"]] + ([b["fmeta"]["dataset"]] if b["fmeta"] else [])),
            "limitations": limitations(meta), "resolution_m": 100}


def _hazard_payload(b: dict, extra: dict | None = None) -> dict:
    rows = b["rows"]
    obs_mm = [r["mean"] for r in rows if r["mean"] is not None]
    prone = b.get("prone")
    triggered = sum(1 for r in rows if r["trigger_class"] > 0 and (prone is None or r["adm3_pcode"] in prone))
    risk_layer = next(l for l in b["layers"] if l["key"] == "risk")
    out = {
        "model": "tambon",
        "trigger_ratio": None,
        "class_area_km2": b["stats"]["class_area_km2"],
        "tile_url": risk_layer["tile_url"],
        "legend": risk_layer["legend"],
        "layers": b["layers"],
        "triggered_tambons": triggered,
        "tambons_total": len(rows),
        "antecedent_mm": round(sum(obs_mm) / len(obs_mm), 1) if obs_mm else 0.0,
        "antecedent_days": b["region_days"],
        **_payload_common(b),
    }
    out.update(extra or {})
    return out


def _exposure_payload(b: dict, min_class: str) -> dict:
    rows, stats = b["rows"], b["stats"]["rows"]
    table = tambon_table(rows, stats)
    total_people = sum((s.get("people_high") or 0) for s in stats.values())
    people = round_people(total_people)
    hs = household_size()
    fac = b.get("facilities") or {"items": [], "hospitals": 0, "schools": 0}
    tot = b["stats"].get("totals")          # present when the features precompute exists
    feat = {"buildings": round_buildings(tot["buildings"]), "road_km": round(tot["road_km"], 1), "schools": int(round(tot["schools"])),
            "hospitals": int(round(tot["hospitals"]))} if tot else {"buildings": None, "road_km": None, "schools": None, "hospitals": None}
    return {
        "model": "tambon", "people": people, "households_est": round_people(total_people / hs), "household_size_assumed": hs,
        **feat, "building_area_m2": None, "road_km_by_class": None, "shelters": None, "bridges": None,
        "top_admin_units": table, "tambon_table": table, "tambons_ranked": len(rows),
        "tambon_risks": [{"code": r["adm3_pcode"], "name": r["adm3_name"], "name_th": r["adm3_name1"], "amphoe": r["adm2_name"], "amphoe_th": r["adm2_name1"],
                          "risk": round(stats.get(r["adm3_pcode"], {}).get("risk_max") or 0.0, 2), "trigger": r["trigger_class"],
                          "rain": None if r["rain30_mm"] is None else round(r["rain30_mm"]), "people": round_people(stats.get(r["adm3_pcode"], {}).get("people_high") or 0.0)}
                         for r in rows],
        "facilities": fac["items"][:FACILITY_CAP], "facilities_named": {"hospitals": fac["hospitals"], "schools": fac["schools"]},
        "min_class": min_class, **_payload_common(b),
        "limitations": limitations(b["meta"], FEATURE_LIMITS if tot else [NO_FEATURES]),
    }


# ---------------- public API (same shape as ee_backend) ----------------
def hazard_scenario(area, rainfall_mm: float, duration_h: float) -> dict:
    d = max(1, math.ceil(duration_h / 24))
    b = _compute(area, rainfall_mm, max(0, tambon_risk.cfg()["trigger"]["window_days"] - d), None, "High")
    return _hazard_payload(b)


def exposure(area, rainfall_mm: float, duration_h: float, min_class: str = "High", forecast_days: int | None = None) -> dict:
    if forecast_days:        # forecast mode: reuse the SAME computation as forecast_hazard (observed + GFS), never re-add the rain
        H = int(forecast_days)
        return _exposure_payload(_compute(area, 0.0, max(0, tambon_risk.cfg()["trigger"]["window_days"] - H), (H,), min_class), min_class)
    d = max(1, math.ceil(duration_h / 24))
    return _exposure_payload(_compute(area, rainfall_mm, max(0, tambon_risk.cfg()["trigger"]["window_days"] - d), None, min_class), min_class)


def forecast_hazard(area, horizon_days: int = 5) -> dict:
    H = int(horizon_days)
    b = _compute(area, 0.0, max(0, tambon_risk.cfg()["trigger"]["window_days"] - H), (H,), "High")
    fm = b["fmeta"]
    cover = [f"GFS run covers only {fm['covered_hours']} h of the requested {fm['horizon_h']} h."] if fm["covered_hours"] < fm["horizon_h"] else []
    f_mean = _mean_forecast(b)
    out = _hazard_payload(b)
    out["limitations"] = out["limitations"] + [
        f"Forecast part is GFS accumulated rainfall over {H} day(s) from model run {fm['model_run_time']}; the observed part is the preceding {b['region_days']} days. "
        "There can be a gap of about a day between the newest observation and the forecast start."] + cover
    out.update(forecast_rain_mm=round(f_mean, 1), observed_rain_mm=out["antecedent_mm"], horizon_days=H, model_run_time=fm["model_run_time"])
    return out


def _mean_forecast(b: dict) -> float:
    rows = b["rows"]
    obs = [r["mean"] for r in rows if r["mean"] is not None]
    tot = [r["rain30_mm"] for r in rows if r["rain30_mm"] is not None]
    return (sum(tot) / len(tot) - sum(obs) / len(obs)) if tot and obs else 0.0


def explain(lat: float, lng: float) -> dict:
    init()
    pt = ee.Geometry.Point([lng, lat])
    c = tambon_risk.cfg()
    bands = ee.Image.cat([tambon_risk.susceptibility(), tambon_risk.susceptibility_class(), tambon_risk.vulnerability_index(), tambon_risk.vulnerability_class(),
                          tambon_risk.exposure_index(), tambon_risk.exposure_class()])
    vals = get_info(bands.reduceRegion(ee.Reducer.first(), pt, 12, maxPixels=1e6))
    tam = get_info(ee.FeatureCollection(c["assets"]["thresholds"]).filterBounds(pt).first().toDictionary(
        ["adm3_name", "adm2_name", "adm1_name"] + c["trigger"]["columns"]))
    sc, vc, ec = vals.get("susc_class"), vals.get("vuln_class"), vals.get("expo_class")
    factors = [
        {"name": "Susceptibility (CNN, 0-100)", "value": vals.get("s"), "contribution": (sc or 0) / 5},
        {"name": "Vulnerability class (1-5)", "value": vc, "contribution": (vc or 0) / 5},
        {"name": "Exposure class (1-5)", "value": ec, "contribution": (ec or 0) / 5},
    ]
    place = ", ".join(str(tam[k]) for k in ("adm3_name", "adm2_name", "adm1_name") if tam and tam.get(k))
    thr = {k: tam[k] for k in c["trigger"]["columns"] if tam and tam.get(k) is not None}
    return {
        "factors": factors, "susceptibility": vals.get("s"), "S": None,
        "summary": (f"{place}. " if place else "") + ("Below the susceptibility threshold: treated as not susceptible." if (vals.get("s") or 0) < c["susceptibility_threshold"]
                                                         else f"Susceptibility class {sc}, vulnerability class {vc}, exposure class {ec}."),
        "tambon_thresholds_mm": thr,
        "limitations": ["Point values are sampled at 12 m and are indicative only."],
    }
