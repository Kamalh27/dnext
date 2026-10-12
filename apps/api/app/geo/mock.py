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
    ante_days = load_yaml("thresholds.yaml")["antecedent"]["days"]
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
        "antecedent_mm": round(40 + 160 * _seed(area.admin_code, "w"), 1),
        "antecedent_days": ante_days,
        "class_area_km2": {k: round(v, 1) for k, v in classes.items()},
        "tile_url": "",  # no tiles in mock mode
        "legend": legend(),
        "resolution_m": 100,
        "date_of_data": "mock",
        "data_sources": ["mock"],
        "limitations": [MOCK_NOTE],
    }


def _facilities(area: Area, n_school: int, n_hosp: int, n_shelter: int) -> list[dict]:
    w, so, e, n = area.bbox
    out = []
    for kind, count in (("school", n_school), ("hospital", n_hosp), ("shelter", n_shelter)):
        for i in range(min(count, 60)):
            out.append({
                "lat": round(so + (n - so) * (0.1 + 0.8 * _seed(area.admin_code, kind, i, "lat")), 5),
                "lng": round(w + (e - w) * (0.1 + 0.8 * _seed(area.admin_code, kind, i, "lng")), 5),
                "name": f"MOCK {kind} {i + 1} ({area.name})", "kind": kind,
            })
    return out[:200]


def exposure(area: Area, rainfall_mm: float, duration_h: float, min_class: str = "High") -> dict:
    hs = load_yaml("thresholds.yaml")["exposure"]["household_size"]
    tr = trigger_ratio(rainfall_mm, duration_h)
    base = 40_000 * tr * (0.5 + _seed(area.admin_code, "p"))
    people = round(base, -2)
    buildings = round(people / 3.2, -1)
    road_km = round(people / 150, 1)
    schools, hospitals = int(people // 4000), int(people // 25000)
    shelters = int(people // 8000)
    units = [
        {"name": f"{n} ({area.name})", "name_th": f"บ้าน{chr(0x0E01 + i)} ({area.name_th})",
         "admin_code": f"{area.admin_code}{i + 1:02d}",
         "people": round(base * (0.25 / (i + 1)), -2),
         "buildings": round(buildings * (0.25 / (i + 1)), -1),
         "road_km": round(road_km * (0.25 / (i + 1)), 1)}
        for i, n in enumerate(_TAMBON)
    ]
    shares = {"primary": 0.1, "secondary": 0.15, "tertiary": 0.2, "local": 0.45, "track": 0.1}
    return {
        "people": people,
        "households_est": round(people / hs, -2),
        "household_size_assumed": hs,
        "buildings": buildings,
        "building_area_m2": round(buildings * 85, -3),
        "road_km": road_km,
        "road_km_by_class": {k: round(road_km * v, 1) for k, v in shares.items()},
        "schools": schools,
        "hospitals": hospitals,
        "shelters": shelters,
        "facilities": _facilities(area, schools, hospitals, shelters),
        "top_admin_units": units,
        "min_class": min_class,
        "resolution_m": 100,
        "date_of_data": "mock",
        "data_sources": ["mock"],
        "limitations": [MOCK_NOTE, "Households are an estimate (people / household size)."],
    }


def forecast_hazard(area: Area, horizon_days: int = 5) -> dict:
    """Synthetic forecast: observed + forecast rain, then hazard as for a what-if."""
    observed = round(30 + 120 * _seed(area.admin_code, "obs"), 1)
    forecast = round(60 + 240 * _seed(area.admin_code, "fc", horizon_days), 1)
    h = hazard_scenario(area, max(forecast, 1.0), horizon_days * 24)
    h["limitations"] = h["limitations"] + ["MOCK forecast: not a real NWP product."]
    return {**h, "forecast_rain_mm": forecast, "observed_rain_mm": observed,
            "horizon_days": horizon_days, "model_run_time": "MOCK-2000-01-01T00:00Z"}


def explain(lat: float, lng: float) -> dict:
    s = _seed(round(lat, 3), round(lng, 3))
    return {
        "factors": [
            {"name": "slope", "value": round(10 + 30 * s, 1), "contribution": 0.35},
            {"name": "landcover", "value": "cropland", "contribution": 0.15},
        ],
        "limitations": [MOCK_NOTE],
    }
