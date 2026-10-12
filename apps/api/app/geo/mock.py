"""Deterministic mock geo backend (GEO_BACKEND=mock). Numbers are FAKE fixtures; every payload says so."""
import hashlib

from app.geo.areas import Area
from app.geo.hazard_math import trigger_ratio
from app.settings import load_yaml

MOCK_NOTE = "MOCK DATA: synthetic fixtures for development, not real hazard or exposure values."
_TAMBON = ["Ban A", "Ban B", "Ban C", "Ban D", "Ban E", "Ban F", "Ban G", "Ban H", "Ban I", "Ban J"]


def _seed(*parts) -> float:
    h = hashlib.sha256("|".join(map(str, parts)).encode()).digest()
    return int.from_bytes(h[:4], "big") / 2**32


def legend():
    h = load_yaml("thresholds.yaml")["hazard"]
    return [{"label": n, "color": c} for n, c in zip(h["class_names"], h["class_colors"])]


def hazard_scenario(area: Area, rainfall_mm: float, duration_h: float) -> dict:
    tr = trigger_ratio(rainfall_mm, duration_h)
    share_high = min(0.6, 0.05 + 0.12 * tr * (0.6 + _seed(area.admin_code)))
    area_km2 = 8000 * (0.5 + _seed(area.admin_code, "a"))
    classes = {
        "Very High": area_km2 * share_high * 0.3,
        "High": area_km2 * share_high * 0.7,
        "Moderate": area_km2 * 0.25,
    }
    classes["Low"] = area_km2 - sum(classes.values())
    return {
        "trigger_ratio": round(tr, 2),
        "class_area_km2": {k: round(v, 1) for k, v in classes.items()},
        "tile_url": "",  # no tiles in mock mode
        "legend": legend(),
        "resolution_m": 100,
        "date_of_data": "mock",
        "data_sources": ["mock"],
        "limitations": [MOCK_NOTE],
    }


def exposure(area: Area, rainfall_mm: float, duration_h: float, min_class: str = "High") -> dict:
    hs = load_yaml("thresholds.yaml")["exposure"]["household_size"]
    tr = trigger_ratio(rainfall_mm, duration_h)
    base = 40_000 * tr * (0.5 + _seed(area.admin_code, "p"))
    people = round(base, -2)
    units = [
        {"name": f"{n} ({area.name})", "people": round(base * (0.25 / (i + 1)), -2)}
        for i, n in enumerate(_TAMBON)
    ]
    return {
        "people": people,
        "households_est": round(people / hs, -2),
        "household_size_assumed": hs,
        "buildings": round(people / 3.2, -1),
        "road_km": round(people / 150, 1),
        "schools": int(people // 4000),
        "hospitals": int(people // 25000),
        "top_admin_units": units,
        "min_class": min_class,
        "resolution_m": 100,
        "date_of_data": "mock",
        "data_sources": ["mock"],
        "limitations": [MOCK_NOTE, "Households are an estimate (people / household size)."],
    }


def explain(lat: float, lng: float) -> dict:
    s = _seed(round(lat, 3), round(lng, 3))
    return {
        "factors": [
            {"name": "slope", "value": round(10 + 30 * s, 1), "contribution": 0.35},
            {"name": "landcover", "value": "cropland", "contribution": 0.15},
        ],
        "limitations": [MOCK_NOTE],
    }
