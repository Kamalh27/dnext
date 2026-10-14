"""One-off precompute: per-tambon histogram of the static risk product (susceptibility x vulnerability x exposure classes, 0..125)
with area (km2) and population (WorldPop 2020) per value, plus mean exposure index/class.

Because the rainfall trigger is ONE number per tambon, every scenario's tambon statistics (risk mean/max, share of area and people
above a risk cutoff, class areas) follow from this histogram and that number, computed in Python with no Earth Engine call.
Re-run only when the susceptibility/vulnerability/exposure layers (or WorldPop) change.

  cd apps/api && uv run python ../../scripts/precompute_static_stats.py            # -> .local_storage/risk/static_stats.json
  cd apps/api && uv run python ../../scripts/precompute_static_stats.py --bucket <your-project-id>-dnext
Requires risk_static_asset (scripts/build_risk_layer.py); falls back to the 12 m sources (much slower) if it is not recorded.
"""
import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as c  # noqa: E402


def main(argv=None) -> int:
    c.setup_logging()
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--bucket", default="")
    p.add_argument("--out", default=".local_storage/risk/static_stats.json")
    p.add_argument("--workers", type=int, default=5)
    a = p.parse_args(argv)
    c.ee_init("")
    import ee
    from app.geo import tambon_risk
    from app.geo.ee_init import get_info
    from app.geo.static_stats import GCS_BLOB

    s = tambon_risk.static_stats_bands()
    img = ee.Image.cat([ee.Image.pixelArea().divide(1e6).rename("area"), tambon_risk.worldpop().unmask(0).rename("pop"),
                        s.select("prod").unmask(0).toInt().rename("prod")])
    thr = ee.FeatureCollection(tambon_risk.cfg()["assets"]["thresholds"])
    provinces = sorted(get_info(thr.aggregate_array("adm1_pcode").distinct()))

    def one(pc: str) -> dict:
        fc = thr.filter(ee.Filter.eq("adm1_pcode", pc))
        hist = img.reduceRegions(collection=fc, reducer=ee.Reducer.sum().repeat(2).group(groupField=2, groupName="prod"),
                                 scale=tambon_risk.STATS_SCALE_M, tileScale=4)
        means = s.select(["expo", "expo_class"]).reduceRegions(collection=fc, reducer=ee.Reducer.mean(), scale=tambon_risk.STATS_SCALE_M, tileScale=4)
        res = get_info(ee.Dictionary({"h": hist.select(["adm3_pcode", "groups"], retainGeometry=False).toList(10000),
                                      "m": means.select(["adm3_pcode", "expo", "expo_class"], retainGeometry=False).toList(10000)}))
        out: dict = {}
        for f in res["h"]:
            pr = f["properties"]
            g = pr.get("groups") or []
            out[pr["adm3_pcode"]] = {"area": round(sum(x["sum"][0] for x in g), 5),
                                     "h": {str(int(x["prod"])): [round(x["sum"][0], 5), round(x["sum"][1], 2)] for x in g}}
        for f in res["m"]:
            pr = f["properties"]
            if pr["adm3_pcode"] in out:
                out[pr["adm3_pcode"]].update(ex=pr.get("expo"), ec=pr.get("expo_class"))
        c.log.info("  %s: %d tambons", pc, len(out))
        return out

    t0 = time.time()
    tambon: dict = {}
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        for part in ex.map(one, provinces):
            tambon.update(part)
    doc = {"generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "scale_m": tambon_risk.STATS_SCALE_M, "tambon": tambon}
    path = Path(a.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, separators=(",", ":")))
    c.log.info("wrote %s (%d tambons, %.1f MB) in %.0fs", path, len(tambon), path.stat().st_size / 1e6, time.time() - t0)
    if a.bucket:
        from google.cloud import storage
        storage.Client().bucket(a.bucket).blob(GCS_BLOB).upload_from_filename(str(path), content_type="application/json")
        c.log.info("uploaded gs://%s/%s", a.bucket, GCS_BLOB)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
