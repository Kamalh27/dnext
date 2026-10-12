"""Rainfall inputs: IMERG antecedent accumulation, GFS forecast, CHIRPS historical replay.

Pure helpers (no EE) are separate so they can be unit-tested; EE functions build lazy images.
Units/facts (EE catalog):
 - NASA/GPM_L3/IMERG_V07 `precipitation`: mm/HOUR, one image per 30 min  => each image adds value*0.5 mm.
 - NOAA/GFS0P25 `total_precipitation_surface`: mm accumulated over the previous ((F-1)%6)+1 hours,
   F = forecast_hours. Windows restart every 6 h, so images inside a 6 h bucket are CUMULATIVE, not additive.
 - UCSB-CHG/CHIRPS/DAILY `precipitation`: mm/day (1-2 month latency -> historical replay only).
"""
import time
from datetime import datetime, timezone

import ee

from app.geo.ee_init import get_info, init
from app.settings import assets, load_yaml

IMERG_STEP_H = 0.5
HALF_HOUR_MS = 30 * 60 * 1000
DAY_MS = 86_400_000
_NEWEST_TTL_S = 1800
_newest_cache: dict = {}


# ---------------- pure helpers ----------------
def wetness(total_mm: float, reference_mm: float | None = None) -> float:
    ref = reference_mm or load_yaml("thresholds.yaml")["antecedent"]["reference_mm"]
    return max(0.0, min(1.0, total_mm / ref))


def imerg_window_ms(newest_start_ms: int, days: int) -> tuple[int, int]:
    """[start,end) covering exactly `days` days of 30-min images ending with the newest image."""
    end = newest_start_ms + HALF_HOUR_MS
    return end - days * DAY_MS, end


def ms_to_date(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def ms_to_iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%MZ")


def gfs_window(f: int) -> tuple[int, int]:
    """(start_h, end_h) of the accumulation window carried by the image with forecast_hours=f."""
    return f - (((f - 1) % 6) + 1), f


def gfs_windows(forecast_hours, horizon_h: int | None = None) -> list[int]:
    """Choose the forecast_hours whose accumulations sum to total rain WITHOUT double counting.

    Within each 6 h bucket b=(F-1)//6 the images are cumulative from the bucket start, so only the
    LARGEST available F in each bucket (<= horizon) is kept: F%6==0 images give full 6 h buckets, and the
    last partial bucket contributes its remainder. Selected windows are asserted disjoint."""
    best: dict[int, int] = {}
    for f in sorted({int(x) for x in forecast_hours}):
        if f <= 0 or (horizon_h is not None and f > horizon_h):
            continue
        b = (f - 1) // 6
        best[b] = max(f, best.get(b, 0))
    chosen = sorted(best.values())
    prev_end = 0
    for f in chosen:
        s, e = gfs_window(f)
        assert s >= prev_end, f"overlapping GFS windows at F={f}"
        prev_end = e
    return chosen


def gfs_covered_hours(chosen: list[int]) -> int:
    return sum(gfs_window(f)[1] - gfs_window(f)[0] for f in chosen)


# ---------------- Earth Engine ----------------
def _imerg() -> ee.ImageCollection:
    return ee.ImageCollection(assets()["imerg"]).select("precipitation")


def newest_imerg_ms() -> int:
    """system:time_start (ms) of the newest IMERG image; cached ~30 min. Never assumes 'today'."""
    now = time.time()
    hit = _newest_cache.get("v")
    if hit and now - hit[0] < _NEWEST_TTL_S:
        return hit[1]
    init()
    v = get_info(_imerg().aggregate_max("system:time_start"))
    if v is None:
        raise RuntimeError("IMERG collection returned no images")
    _newest_cache["v"] = (now, int(v))
    return int(v)


def antecedent_total_image(days: int | None = None) -> tuple[ee.Image, dict]:
    """(sum image in mm over the last `days`, meta{newest_ms, date_of_data, days})."""
    days = days or load_yaml("thresholds.yaml")["antecedent"]["days"]
    newest = newest_imerg_ms()
    start, end = imerg_window_ms(newest, days)
    total = _imerg().filterDate(start, end).sum().multiply(IMERG_STEP_H).rename("antecedent_mm")
    return total, {"newest_ms": newest, "date_of_data": ms_to_date(newest), "days": days}


def wetness_image(total: ee.Image, reference_mm: float | None = None) -> ee.Image:
    ref = reference_mm or load_yaml("thresholds.yaml")["antecedent"]["reference_mm"]
    return total.divide(ref).max(0).min(1).rename("W")


def region_mean(img: ee.Image, region: ee.Geometry, scale: int = 11132) -> float:
    """Mean of a single-band image over region (IMERG native ~0.1 deg ~ 11 km, GFS 0.25 deg)."""
    d = get_info(img.reduceRegion(ee.Reducer.mean(), region, scale, bestEffort=True, maxPixels=int(1e9)))
    v = next(iter(d.values()), None) if d else None
    return float(v) if v is not None else 0.0


def antecedent(region: ee.Geometry, days: int | None = None) -> dict:
    total, meta = antecedent_total_image(days)
    mm = region_mean(total, region)
    return {**meta, "antecedent_mm": mm, "wetness": wetness(mm), "total_image": total}


def gfs_forecast(region: ee.Geometry, horizon_days: int = 5) -> dict:
    """Latest GFS run: AOI-mean accumulated rain over the next horizon_days. Raises if no usable run."""
    init()
    ds = assets()["gfs"]
    horizon_h = 24 * horizon_days
    now_ms = int(time.time() * 1000)
    coll = ee.ImageCollection(ds).filterDate(now_ms - 10 * DAY_MS, now_ms + 20 * DAY_MS)
    run = coll.aggregate_max("creation_time")
    run_coll = coll.filter(ee.Filter.eq("creation_time", run))
    meta = get_info(ee.Dictionary({"run": run, "fh": run_coll.aggregate_array("forecast_hours")}))
    if not meta.get("run") or not meta.get("fh"):
        raise RuntimeError("No GFS forecast images found")
    chosen = gfs_windows(meta["fh"], horizon_h)
    if not chosen:
        raise RuntimeError("GFS run has no forecast_hours in the requested horizon")
    imgs = (coll.filter(ee.Filter.eq("creation_time", int(meta["run"])))
            .filter(ee.Filter.inList("forecast_hours", chosen))
            .select("total_precipitation_surface"))
    total = imgs.sum().rename("forecast_mm")
    return {
        "forecast_mm": region_mean(total, region, 27830),
        "model_run_time": ms_to_iso(int(meta["run"])),
        "covered_hours": gfs_covered_hours(chosen),
        "horizon_h": horizon_h,
        "dataset": ds,
    }


def historical_rain(start: str, end: str, region: ee.Geometry) -> dict:
    """CHIRPS daily accumulation (mm) over [start, end) (YYYY-MM-DD), AOI mean. For historical replay only."""
    init()
    ds = "UCSB-CHG/CHIRPS/DAILY"
    total = ee.ImageCollection(ds).filterDate(start, end).select("precipitation").sum()
    return {"rain_mm": region_mean(total, region, 5566), "start": start, "end": end, "dataset": ds}
