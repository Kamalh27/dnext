"""Daily precomputed per-tambon rainfall (observed daily GSMaP + GFS forecast), so a request needs no rainfall reduction.

Written by scripts/precompute_dmr_rain.py (run daily). Read from, in order: $DMR_OBS_PATH, ./.local_storage/dmr/obs_daily.json,
gs://$PROJECT_ID-dnext/dmr/obs_daily.json. Falls back to live Earth Engine when absent, for another source than configured, or stale.
Observed day i (d[i]) covers [end - (i+1) d, end - i d) where end = newest image + 1 step, matching rain.observed_image().
"""
import json
import logging
import os
import threading
import time
from pathlib import Path

from app.settings import settings

log = logging.getLogger(__name__)
LOCAL = Path(".local_storage/dmr/obs_daily.json")
GCS_BLOB = "dmr/obs_daily.json"
MAX_AGE_MS = 3 * 86_400_000          # GSMaP is ~1 day behind; the job runs daily
MAX_FORECAST_AGE_MS = 36 * 3_600_000      # a daily job leaves the newest run up to ~31 h old just before the next one; the run time is always shown
_lock = threading.Lock()
_mem: dict = {"t": 0.0, "data": None}
_TTL_S = 600


def _read() -> dict | None:
    p = os.environ.get("DMR_OBS_PATH")
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
            log.info("obs cache: GCS not available (%s)", str(e)[:80])
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


def usable(data: dict | None, source: str, days_needed: int = 0) -> bool:
    if not data or data.get("source") != source:
        return False
    return (time.time() * 1000 - data["newest_ms"]) < MAX_AGE_MS and data.get("days", 0) >= days_needed


def _match(area, t: dict) -> bool:
    level = getattr(area, "level", None)
    pcode = getattr(area, "pcode", None) or getattr(area, "admin_code", None)
    key = {"province": "pc", "amphoe": "ac", "tambon": "code"}.get(level or "")
    return bool(key and pcode and (t["code"] if key == "code" else t[key]) == pcode)


def _row(code: str, t: dict, mean) -> dict:
    return {"adm3_pcode": code, "adm3_name": t["n"], "adm3_name1": t["nt"], "adm2_pcode": t["ac"], "adm2_name": t["a"], "adm2_name1": t["at"],
            "adm1_pcode": t["pc"], "adm1_name": t["p"], "adm1_name1": t["pt"], "area_sqkm": t["area"], "center_lat": t["lat"],
            "center_lon": t["lon"], "thresholds": t["thr"], "mean": mean}


def observed_rows(data: dict, area, days: int) -> list[dict] | None:
    """Per-tambon observed rainfall over the last `days` days (same row shape as dmr.tambon_mean_rows). None if the area is unknown."""
    rows = []
    for code, t in data["tambon"].items():
        t = {**t, "code": code}
        if _match(area, t):
            d = t["d"][:days]
            rows.append(_row(code, t, None if (days and not d) or any(v is None for v in d) else float(sum(d))))
    return rows or None


def forecast_means(data: dict, area, horizon_days: int) -> dict[str, float] | None:
    """pcode -> mean GFS accumulated mm over the next horizon_days, if the cached run is fresh and covers it."""
    f = data.get("forecast")
    if not f or horizon_days not in {int(k) for k in f.get("horizons", {})}:
        return None
    if time.time() * 1000 - f["run_ms"] > MAX_FORECAST_AGE_MS:      # GFS runs every 6 h; older than 18 h = stale
        return None
    out = {}
    for code, t in data["tambon"].items():
        if _match(area, {**t, "code": code}) and t.get("f") and len(t["f"]) >= horizon_days:
            out[code] = float(t["f"][horizon_days - 1] or 0.0)
    return out or None
