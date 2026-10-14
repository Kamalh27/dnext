"""Backend facade. Selects mock or EE by GEO_BACKEND; caches by scenario hash."""
import hashlib
import json
from datetime import date

from app.geo import cache, mock
from app.geo.areas import Area
from app.geo.hazard_math import validate_inputs
from app.settings import settings

MIN_CLASSES = ("Moderate", "High", "Very High")


def _hash(*parts) -> str:
    return hashlib.sha256(json.dumps(parts).encode()).hexdigest()[:16]


def scenario_id(area: Area, rainfall_mm: float, duration_h: float, min_class: str = "High") -> str:
    parts = [area.admin_code, rainfall_mm, duration_h, date.today().isoformat()]
    parts += _model_part()
    if min_class != "High":      # keep default ids stable
        parts.append(min_class)
    return _hash(*parts)


def forecast_id(area: Area, horizon_days: int) -> str:
    return _hash("forecast", area.admin_code, horizon_days, date.today().isoformat(), *_model_part())


def _model_part() -> list[str]:
    """Cache-key part so results from different hazard models never mix (keeps old ids stable for screening)."""
    return ["tambon"] if settings().geo_backend == "ee" and settings().hazard_model == "tambon" else []


def _backend():
    if settings().geo_backend == "ee":
        if settings().hazard_model == "tambon":
            from app.geo import tambon_backend  # lazy: needs EE auth
            return tambon_backend
        from app.geo import ee_backend
        return ee_backend
    return mock


def run_scenario(area: Area, rainfall_mm: float, duration_h: float, min_class: str = "High") -> dict:
    validate_inputs(rainfall_mm, duration_h)
    if min_class not in MIN_CLASSES:
        raise ValueError(f"min_class must be one of {MIN_CLASSES}")
    sid = scenario_id(area, rainfall_mm, duration_h, min_class)
    if (hit := cache.get(sid)) is not None:
        return {**hit, "cached": True}
    b = _backend()
    result = {
        "scenario_id": sid,
        "kind": "what_if",
        "area": area.dict(),
        "rainfall_mm": rainfall_mm,
        "duration_h": duration_h,
        "hazard": b.hazard_scenario(area, rainfall_mm, duration_h),
        "exposure": b.exposure(area, rainfall_mm, duration_h, min_class),
    }
    cache.put(sid, result, cache.TTL_WHATIF_S)
    return {**result, "cached": False}


def run_forecast(area: Area, horizon_days: int = 5) -> dict:
    if not (1 <= horizon_days <= 10):
        raise ValueError("horizon_days must be between 1 and 10")
    sid = forecast_id(area, horizon_days)
    if (hit := cache.get(sid)) is not None:
        return {**hit, "cached": True}
    b = _backend()
    hz = b.forecast_hazard(area, horizon_days)
    fc = {k: hz[k] for k in ("forecast_rain_mm", "observed_rain_mm", "horizon_days", "model_run_time")}
    rain = max(fc["forecast_rain_mm"] + fc["observed_rain_mm"], 0.1)
    result = {
        "scenario_id": sid,
        "kind": "forecast",
        "area": area.dict(),
        "rainfall_mm": round(rain, 1),          # observed + forecast, so UI labels work unchanged
        "duration_h": horizon_days * 24,
        "forecast": fc,
        "hazard": {k: v for k, v in hz.items() if k not in fc},
        "exposure": b.exposure(area, rain, horizon_days * 24, "High", forecast_days=horizon_days),
    }
    cache.put(sid, result, cache.TTL_FORECAST_S)
    return {**result, "cached": False}


def get_cached(sid: str) -> dict | None:
    return cache.get(sid)


def explain_point(lat: float, lng: float, scenario_id: str | None = None) -> dict:
    out = dict(_backend().explain(lat, lng))
    if scenario_id and (sc := cache.get(scenario_id)):
        out["scenario"] = {"scenario_id": scenario_id, "area": sc["area"]["name"],
                           "rainfall_mm": sc["rainfall_mm"], "duration_h": sc["duration_h"]}
    return out
