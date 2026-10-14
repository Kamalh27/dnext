"""Daily precompute: per-tambon observed daily rainfall (GSMaP, last 30 days) and GFS forecast accumulations (1..10 days).

Output JSON (read by app/geo/obs_cache.py): .local_storage/dmr/obs_daily.json, and gs://<bucket>/dmr/obs_daily.json with --bucket.
Run once a day (Cloud Scheduler -> Cloud Run job, or cron). ~77 province-sized reductions in parallel; a few minutes.

  cd apps/api && uv run python ../../scripts/precompute_dmr_rain.py
  cd apps/api && uv run python ../../scripts/precompute_dmr_rain.py --bucket <your-project-id>-lw     # also upload to GCS
"""
import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as c  # noqa: E402

DAYS = 30
HORIZONS = range(1, 11)


def main(argv=None) -> int:
    c.setup_logging()
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--bucket", default="", help="also upload to gs://BUCKET/dmr/obs_daily.json")
    p.add_argument("--out", default=".local_storage/dmr/obs_daily.json")
    p.add_argument("--workers", type=int, default=6)
    p.add_argument("--no-forecast", action="store_true")
    a = p.parse_args(argv)
    c.ee_init("")
    import ee
    from app.geo import dmr, rain
    from app.geo.ee_init import get_info
    from app.geo.obs_cache import GCS_BLOB

    src = dmr.cfg()["trigger"]["observed_source"]
    coll_img, meta = rain.observed_image(1, src)          # just to learn newest + dataset
    newest, ds = meta["newest_ms"], meta["dataset"]
    step_h = 1.0 if src == "gsmap" else 0.5
    end = newest + int(step_h * 3_600_000)
    base = ee.ImageCollection(rain.GSMAP).select("hourlyPrecipRate") if src == "gsmap" else rain._imerg()
    bands = []
    for i in range(DAYS):
        d = base.filterDate(end - (i + 1) * rain.DAY_MS, end - i * rain.DAY_MS).sum().multiply(step_h).rename(f"d{i}")
        bands.append(d)
    stack = ee.Image.cat(bands)
    fmeta: dict = {"horizons": {}}
    if not a.no_forecast:
        fimgs = []
        for h in HORIZONS:
            try:
                img, fm = rain.gfs_forecast_image(h)
            except RuntimeError as e:
                c.log.warning("GFS horizon %s unavailable: %s", h, e)
                continue
            fimgs.append(img.rename(f"f{h}"))
            fmeta["horizons"][str(h)] = fm["covered_hours"]
            fmeta.update(model_run_time=fm["model_run_time"], dataset=fm["dataset"])
        if fimgs:
            stack = stack.addBands(ee.Image.cat(fimgs))
    thr = ee.FeatureCollection(dmr.cfg()["assets"]["thresholds"])
    cols = dmr.cfg()["trigger"]["columns"]
    keep = dmr.TAMBON_KEEP + cols
    provinces = sorted(get_info(thr.aggregate_array("adm1_pcode").distinct()))
    names = [f"d{i}" for i in range(DAYS)] + [f"f{h}" for h in HORIZONS if str(h) in fmeta["horizons"]]
    c.log.info("source=%s newest=%s provinces=%d bands=%d", src, rain.ms_to_date(newest), len(provinces), len(names))

    def one(pc: str):
        fc = thr.filter(ee.Filter.eq("adm1_pcode", pc))
        red = stack.reduceRegions(collection=fc, reducer=ee.Reducer.mean(), scale=dmr.RAIN_SCALE_M, tileScale=4)
        rows = get_info(red.select(keep + names, retainGeometry=False).toList(10000))
        c.log.info("  %s: %d tambons", pc, len(rows))
        return rows

    t0 = time.time()
    tambon: dict = {}
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        for rows in ex.map(one, provinces):
            for f in rows:
                pr = f["properties"]
                tambon[pr["adm3_pcode"]] = {
                    "n": pr.get("adm3_name"), "nt": pr.get("adm3_name1"), "a": pr.get("adm2_name"), "at": pr.get("adm2_name1"), "ac": pr.get("adm2_pcode"),
                    "p": pr.get("adm1_name"), "pt": pr.get("adm1_name1"), "pc": pr.get("adm1_pcode"), "area": pr.get("area_sqkm"),
                    "lat": pr.get("center_lat"), "lon": pr.get("center_lon"), "thr": [pr.get(k) for k in cols],
                    "d": [pr.get(f"d{i}") for i in range(DAYS)],
                    "f": [pr.get(f"f{h}") for h in HORIZONS if str(h) in fmeta["horizons"]]}
    out = {"generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "source": src, "dataset": ds, "newest_ms": newest,
           "date_of_data": rain.ms_to_date(newest), "days": DAYS, "tambon": tambon}
    if fmeta["horizons"]:
        run_iso = fmeta["model_run_time"]
        from datetime import datetime, timezone
        run_ms = int(datetime.strptime(run_iso, "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc).timestamp() * 1000)
        out["forecast"] = {"model_run_time": run_iso, "run_ms": run_ms, "dataset": fmeta["dataset"], "horizons": fmeta["horizons"]}
    path = Path(a.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, separators=(",", ":")))
    c.log.info("wrote %s (%d tambons, %.1f MB) in %.0fs", path, len(tambon), path.stat().st_size / 1e6, time.time() - t0)
    if a.bucket:
        from google.cloud import storage
        storage.Client().bucket(a.bucket).blob(GCS_BLOB).upload_from_filename(str(path), content_type="application/json")
        c.log.info("uploaded gs://%s/%s", a.bucket, GCS_BLOB)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
