"""One-off precompute of the named hospitals and schools that can end up in a Low-or-higher risk zone.

Reads the Geofabrik extract (scripts/out/osm/thailand-latest.osm.pbf), keeps hospitals and schools that have a name, finds each one's
tambon and samples the static risk product at its location. A facility is kept only when it could ever be in the elevated zone:
risk = trigger x product / 125 and the trigger is at most 5, so a product below `ceil(lowest_class_cutoff x 125 / 5)` (25) is dropped.
At request time the API combines the file with the tambon trigger classes to list the facilities at risk (app/geo/static_stats.py).

  cd apps/api && uv run --group scripts python ../../scripts/precompute_facilities.py
Needs the cached tambon polygons from scripts/precompute_features.py (step `geoms`) and the risk_static_asset (scripts/build_risk_layer.py).
OSM data (c) OpenStreetMap contributors, ODbL.
"""
import argparse
import json
import math
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as c  # noqa: E402
import precompute_features as pf  # noqa: E402


def extract_named(pbf: Path) -> list:
    import osmium

    class H(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.items: list = []

        def _add(self, tags, lon, lat):
            kind = tags.get("amenity")
            name = tags.get("name") or tags.get("name:th") or tags.get("name:en")
            if kind in ("hospital", "school") and name:
                self.items.append((kind, lon, lat, tags.get("name:en") or tags.get("name") or "", tags.get("name:th") or tags.get("name") or ""))

        def node(self, n):
            self._add(n.tags, n.location.lon, n.location.lat)

        def way(self, w):                       # building/area: the first node stands in for the place
            nd = next((x for x in w.nodes if x.location.valid()), None)
            if nd and w.tags.get("amenity") in ("hospital", "school"):
                self._add(w.tags, nd.location.lon, nd.location.lat)

    h = H()
    h.apply_file(str(pbf), locations=True, idx="flex_mem")
    return h.items


def main(argv=None) -> int:
    c.setup_logging()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", default=".local_storage/risk/facilities.json")
    a = p.parse_args(argv)
    import numpy as np
    from app.geo import tambon_risk

    if not pf.PBF.exists():
        sys.exit(f"missing {pf.PBF}; download https://download.geofabrik.de/asia/thailand-latest.osm.pbf")
    r = tambon_risk.cfg()["risk"]
    min_prod = math.ceil(r["cutoffs"][0] * r["divisor"] / 5)      # lowest risk class cutoff: a Low-or-higher risk needs at least this
    t0 = time.time()
    items = extract_named(pf.PBF)
    c.log.info("%d named hospitals and schools in the extract (%.0fs)", len(items), time.time() - t0)
    c.ee_init("")
    arr = np.array([(i[1], i[2]) for i in items])
    tambon_of = pf.locate(arr)
    inside = sorted(tambon_of)
    c.log.info("%d fall inside a tambon", len(inside))
    prod = pf.sample_prod(arr, inside)
    by_tambon: dict = {}
    for i in inside:
        pr = prod.get(i, 0)
        if pr < min_prod:
            continue
        kind, lon, lat, name_en, name_th = items[i]
        by_tambon.setdefault(tambon_of[i], []).append([kind, round(lat, 5), round(lon, 5), name_en, name_th, pr])
    doc = {"generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "min_prod": min_prod,
           "columns": ["kind", "lat", "lng", "name", "name_th", "prod"], "source": "OpenStreetMap (Geofabrik thailand-latest), ODbL",
           "tambon": by_tambon}
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
    n = sum(len(v) for v in by_tambon.values())
    c.log.info("wrote %s: %d facilities in %d tambons (product >= %d), %.1f MB", out, n, len(by_tambon), min_prod, out.stat().st_size / 1e6)
    return 0


if __name__ == "__main__":
    sys.exit(main())
