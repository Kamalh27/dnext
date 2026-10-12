"""Backend facade. Selects mock or EE by GEO_BACKEND; caches by scenario hash."""
import hashlib
import json
from datetime import date

from app.geo import mock
from app.geo.areas import Area
from app.geo.hazard_math import validate_inputs
from app.settings import settings

_CACHE: dict[str, dict] = {}   # swapped for Firestore in Day 3


def scenario_id(area: Area, rainfall_mm: float, duration_h: float) -> str:
    key = json.dumps([area.admin_code, rainfall_mm, duration_h, date.today().isoformat()])
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def _backend():
    if settings().geo_backend == "ee":
        from app.geo import ee_backend  # lazy: needs EE auth
        return ee_backend
    return mock


def run_scenario(area: Area, rainfall_mm: float, duration_h: float, min_class: str = "High") -> dict:
    validate_inputs(rainfall_mm, duration_h)
    sid = scenario_id(area, rainfall_mm, duration_h)
    if sid in _CACHE:
        return {**_CACHE[sid], "cached": True}
    b = _backend()
    result = {
        "scenario_id": sid,
        "area": area.dict(),
        "rainfall_mm": rainfall_mm,
        "duration_h": duration_h,
        "hazard": b.hazard_scenario(area, rainfall_mm, duration_h),
        "exposure": b.exposure(area, rainfall_mm, duration_h, min_class),
    }
    _CACHE[sid] = result
    return {**result, "cached": False}


def get_cached(sid: str) -> dict | None:
    return _CACHE.get(sid)


def explain_point(lat: float, lng: float) -> dict:
    return _backend().explain(lat, lng)
