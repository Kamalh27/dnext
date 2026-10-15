"""Scenario tambon statistics from the precomputed static histogram (no Earth Engine call).

For a tambon with trigger class t (a single number per tambon) and static product p (1..125 per pixel):
    risk = t * p / 125.
Per tambon we have area (km2) and population per p, so risk mean/max, the share of the tambon and the people above any risk
cutoff, and the area per risk class are exact sums over that histogram.  Written by scripts/precompute_static_stats.py.
"""
import json
import logging
import os
import threading
import time
from pathlib import Path

from app.geo import tambon_risk
from app.settings import settings

log = logging.getLogger(__name__)
LOCAL = Path(".local_storage/risk/static_stats.json")
GCS_BLOB = "risk/static_stats.json"
FEATURES_LOCAL = Path(".local_storage/risk/static_features.json")
FEATURES_GCS_BLOB = "risk/static_features.json"
_lock = threading.Lock()
_mem: dict = {"t": 0.0, "data": None}
_TTL_S = 3600


def _read() -> dict | None:
    p = os.environ.get("RISK_STATIC_STATS_PATH")
    for path in ([Path(p)] if p else []) + [LOCAL]:
        if path.is_file():
            return json.loads(path.read_text())
    project = settings().project_id or settings().ee_project
    if project:
        try:
            from google.cloud import storage
            blob = storage.Client(project=project).bucket(f"{project}-dnext").blob(GCS_BLOB)
            if blob.exists():
                return json.loads(blob.download_as_text())
        except Exception as e:  # noqa: BLE001
            log.info("static stats: GCS not available (%s)", str(e)[:80])
    return None


def load() -> dict | None:
    now = time.time()
    with _lock:
        if now - _mem["t"] < _TTL_S:
            return _mem["data"]
    data = _read()
    with _lock:
        _mem.update(t=now, data=data)
    return data


def reset() -> None:
    with _lock:
        _mem.update(t=0.0, data=None)


_fmem: dict = {"t": 0.0, "data": None}


def load_features() -> dict | None:
    """Per-tambon histograms of buildings (GHSL), hospitals, schools and main roads (OSM) by static risk product, if built."""
    now = time.time()
    with _lock:
        if now - _fmem["t"] < _TTL_S:
            return _fmem["data"]
    data = None
    p = os.environ.get("RISK_STATIC_FEATURES_PATH")
    for path in ([Path(p)] if p else []) + [FEATURES_LOCAL]:
        if path.is_file():
            data = json.loads(path.read_text())
            break
    if data is None and (settings().project_id or settings().ee_project):
        try:
            from google.cloud import storage
            project = settings().project_id or settings().ee_project
            blob = storage.Client(project=project).bucket(f"{project}-dnext").blob(FEATURES_GCS_BLOB)
            if blob.exists():
                data = json.loads(blob.download_as_text())
        except Exception as e:  # noqa: BLE001
            log.info("static features: GCS not available (%s)", str(e)[:80])
    with _lock:
        _fmem.update(t=now, data=data)
    return data


FAC_LOCAL = Path(".local_storage/risk/facilities.json")
FAC_GCS_BLOB = "risk/facilities.json"
_famem: dict = {"t": 0.0, "data": None}


def load_facilities() -> dict | None:
    """Named hospitals and schools that can reach the elevated zone, per tambon, if the facilities precompute is built."""
    now = time.time()
    with _lock:
        if now - _famem["t"] < _TTL_S:
            return _famem["data"]
    data = None
    p = os.environ.get("RISK_FACILITIES_PATH")
    for path in ([Path(p)] if p else []) + [FAC_LOCAL]:
        if path.is_file():
            data = json.loads(path.read_text())
            break
    if data is None and (settings().project_id or settings().ee_project):
        try:
            from google.cloud import storage
            project = settings().project_id or settings().ee_project
            blob = storage.Client(project=project).bucket(f"{project}-dnext").blob(FAC_GCS_BLOB)
            if blob.exists():
                data = json.loads(blob.download_as_text())
        except Exception as e:  # noqa: BLE001
            log.info("facilities: GCS not available (%s)", str(e)[:80])
    with _lock:
        _famem.update(t=now, data=data)
    return data


def facilities_at_risk(fac: dict | None, rows: list[dict], cutoffs: list[float], divisor: float = 125.0,
                       names: list[str] | None = None, names_th: list[str] | None = None) -> dict:
    """Named hospitals and schools whose risk (tambon trigger x product / divisor) reaches the lowest risk-class cutoff.

    Returns {"items": [...sorted by risk then type...], "hospitals": n, "schools": n}; `items` carries every match (callers cap them)
    and each item has its risk value and risk class (1 = Very low .. 5 = Very high, with the class name when `names` are given)."""
    out = {"items": [], "hospitals": 0, "schools": 0}
    if not fac:
        return out
    for row in rows:
        t = row["trigger_class"]
        if t <= 0:
            continue
        for kind, lat, lng, name, name_th, prod in fac["tambon"].get(row["adm3_pcode"], ()):
            risk = t * prod / divisor
            if risk < cutoffs[0]:
                continue
            cls = 1 + sum(1 for c in cutoffs if risk >= c)
            out["hospitals" if kind == "hospital" else "schools"] += 1
            out["items"].append({"kind": kind, "lat": lat, "lng": lng, "name": name, "name_th": name_th, "risk": round(risk, 2), "risk_class": cls,
                                 **({"risk_class_name": names[cls - 1]} if names else {}), **({"risk_class_name_th": names_th[cls - 1]} if names_th else {}),
                                 "tambon": row["adm3_name"], "tambon_th": row["adm3_name1"], "amphoe": row["adm2_name"], "amphoe_th": row["adm2_name1"],
                                 "admin_code": row["adm3_pcode"]})
    out["items"].sort(key=lambda f: (-f["risk"], f["kind"] != "hospital", f["name"]))
    return out


def covers(data: dict | None, rows: list[dict]) -> bool:
    return bool(data) and all(r["adm3_pcode"] in data["tambon"] for r in rows)


def tambon_stats(data: dict, rows: list[dict], high_value: float | None = None, features: dict | None = None,
                 footprint_m2: float = 60.0) -> dict:
    """Same shape as tambon_risk.tambon_stats(): {"rows": {pcode: {...}}, "class_area_km2": {...}}.
    With `features`, rows also carry buildings (est.), hospitals, schools and road_km inside the elevated zone, and "totals" sums them."""
    r = tambon_risk.cfg()["risk"]
    hv = high_value if high_value is not None else r["cutoffs"][r["exposure_from"] - 2]
    divisor, cutoffs, names = r["divisor"], r["cutoffs"], r["class_names"]
    areas = {n: 0.0 for n in names}
    by_class = [{"class": i + 1, "name": n, "area_km2": 0.0, "people": 0.0, "buildings": 0.0, "hospitals": 0.0, "schools": 0.0, "road_km": 0.0}
                for i, n in enumerate(names)]
    out: dict[str, dict] = {}
    for row in rows:
        code, t = row["adm3_pcode"], row["trigger_class"]
        s = data["tambon"][code]
        hist = {int(p): v for p, v in s["h"].items()}
        total = s["area"] or 0.0
        rec = {"adm3_pcode": code, "rain30_mm": row["rain30_mm"], "trigger_class": t, "expo": s.get("ex"), "expo_class": s.get("ec"),
               "risk": None, "risk_max": None, "share_high": 0.0, "people_high": 0.0}
        if features is not None:
            rec.update(buildings=0.0, hospitals=0.0, schools=0.0, road_km=0.0)
        valid = {p: v for p, v in hist.items() if p >= 1}
        if t > 0 and valid:
            va = sum(v[0] for v in valid.values())
            rec["risk"] = (sum(v[0] * (t * p / divisor) for p, v in valid.items()) / va) if va > 0 else None
            rec["risk_max"] = t * max(valid) / divisor
            hi = [(p, v) for p, v in valid.items() if t * p / divisor >= hv]
            rec["share_high"] = (sum(v[0] for _, v in hi) / total) if total > 0 else 0.0
            rec["people_high"] = sum(v[1] for _, v in hi)
            for p, v in valid.items():
                ci = tambon_risk.risk_class(t * p / divisor, cutoffs) - 1
                areas[names[ci]] += v[0]
                by_class[ci]["area_km2"] += v[0]
                by_class[ci]["people"] += v[1]
            if features is not None:
                for p, f in (features["tambon"].get(code, {}).get("h") or {}).items():       # same classes for the features
                    p = int(p)
                    if p >= 1:
                        b = by_class[tambon_risk.risk_class(t * p / divisor, cutoffs) - 1]
                        b["buildings"] += f[0] / footprint_m2
                        b["hospitals"] += f[1]
                        b["schools"] += f[2]
                        b["road_km"] += f[3]
            if features is not None:
                for p, f in (features["tambon"].get(code, {}).get("h") or {}).items():
                    p = int(p)
                    if p >= 1 and t * p / divisor >= hv:
                        rec["buildings"] += f[0] / footprint_m2
                        rec["hospitals"] += f[1]
                        rec["schools"] += f[2]
                        rec["road_km"] += f[3]
        out[code] = rec
    res = {"rows": out, "class_area_km2": {k: round(v, 1) for k, v in areas.items()}, "by_class": by_class}
    if features is not None:
        res["totals"] = {k: sum(r[k] for r in out.values()) for k in ("buildings", "hospitals", "schools", "road_km")}
    return res
