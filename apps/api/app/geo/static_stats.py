"""Scenario tambon statistics from the precomputed static histogram (no Earth Engine call).

For a tambon with trigger class t (a single number per tambon) and static product p (1..125 per pixel):
    risk = t * p / 125.
Per tambon we have area (km2) and population per p, so risk mean/max, the share of the tambon and the people above any risk
cutoff, and the area per risk class are exact sums over that histogram.  Written by scripts/precompute_dmr_static_stats.py.
"""
import json
import logging
import os
import threading
import time
from pathlib import Path

from app.geo import dmr
from app.settings import settings

log = logging.getLogger(__name__)
LOCAL = Path(".local_storage/dmr/static_stats.json")
GCS_BLOB = "dmr/static_stats.json"
_lock = threading.Lock()
_mem: dict = {"t": 0.0, "data": None}
_TTL_S = 3600


def _read() -> dict | None:
    p = os.environ.get("DMR_STATIC_STATS_PATH")
    for path in ([Path(p)] if p else []) + [LOCAL]:
        if path.is_file():
            return json.loads(path.read_text())
    project = settings().project_id or settings().ee_project
    if project:
        try:
            from google.cloud import storage
            blob = storage.Client(project=project).bucket(f"{project}-lw").blob(GCS_BLOB)
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


def covers(data: dict | None, rows: list[dict]) -> bool:
    return bool(data) and all(r["adm3_pcode"] in data["tambon"] for r in rows)


def tambon_stats(data: dict, rows: list[dict], high_value: float | None = None) -> dict:
    """Same shape as dmr.tambon_stats(): {"rows": {pcode: {...}}, "class_area_km2": {...}}."""
    r = dmr.cfg()["risk"]
    hv = high_value if high_value is not None else r["cutoffs"][r["exposure_from"] - 2]
    divisor, cutoffs, names = r["divisor"], r["cutoffs"], r["class_names"]
    areas = {n: 0.0 for n in names}
    out: dict[str, dict] = {}
    for row in rows:
        code, t = row["adm3_pcode"], row["trigger_class"]
        s = data["tambon"][code]
        hist = {int(p): v for p, v in s["h"].items()}
        total = s["area"] or 0.0
        rec = {"adm3_pcode": code, "rain30_mm": row["rain30_mm"], "trigger_class": t, "expo": s.get("ex"), "expo_class": s.get("ec"),
               "risk": None, "risk_max": None, "share_high": 0.0, "people_high": 0.0}
        valid = {p: v for p, v in hist.items() if p >= 1}
        if t > 0 and valid:
            va = sum(v[0] for v in valid.values())
            rec["risk"] = (sum(v[0] * (t * p / divisor) for p, v in valid.items()) / va) if va > 0 else None
            rec["risk_max"] = t * max(valid) / divisor
            hi = [(p, v) for p, v in valid.items() if t * p / divisor >= hv]
            rec["share_high"] = (sum(v[0] for _, v in hi) / total) if total > 0 else 0.0
            rec["people_high"] = sum(v[1] for _, v in hi)
            for p, v in valid.items():
                areas[names[dmr.risk_class(t * p / divisor, cutoffs) - 1]] += v[0]
        out[code] = rec
    return {"rows": out, "class_area_km2": {k: round(v, 1) for k, v in areas.items()}}
