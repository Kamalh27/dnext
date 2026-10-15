"""One-off precompute of candidate safe places from OpenStreetMap: named places that could serve as shelters or points of help and that sit on
ground that stays at Very low risk even at the highest rainfall trigger (static product below 25, so risk = 5 x product / 125 is below 1).

Kinds: shelter (amenity=shelter, emergency=assembly_point), community (community centre, town hall), school (school, college, university),
temple (place of worship), hospital, sports hall. These are CANDIDATES from open data, not a confirmed list of shelters.

  cd apps/api && uv run --group scripts python ../../scripts/precompute_shelters.py
Needs the cached tambon polygons from scripts/precompute_features.py (step `geoms`, for point-in-tambon), the risk_static_asset and the Geofabrik extract.
OSM data (c) OpenStreetMap contributors, ODbL.
"""
import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as c  # noqa: E402
import precompute_features as pf  # noqa: E402

SAFE_BELOW = 25
KINDS = {"shelter": "shelter", "assembly_point": "shelter", "community_centre": "community", "townhall": "community", "school": "school", "college": "school",
         "university": "school", "place_of_worship": "temple", "hospital": "hospital"}


def _kind(tags) -> str | None:
    if tags.get("emergency") == "assembly_point":
        return "shelter"
    a = tags.get("amenity")
    if a in KINDS:
        return KINDS[a]
    if tags.get("leisure") in ("sports_hall", "sports_centre") and tags.get("sport") != "swimming":
        return "community"
    return None


def extract(pbf: Path) -> list:
    import osmium

    class H(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.items: list = []

        def _add(self, tags, lon, lat):
            kind = _kind(tags)
            name = tags.get("name") or tags.get("name:th") or tags.get("name:en")
            if kind and name:
                self.items.append((kind, lon, lat, tags.get("name:en") or tags.get("name") or "", tags.get("name:th") or tags.get("name") or ""))

        def node(self, n):
            self._add(n.tags, n.location.lon, n.location.lat)

        def way(self, w):
            nd = next((x for x in w.nodes if x.location.valid()), None)
            if nd:
                self._add(w.tags, nd.location.lon, nd.location.lat)

    h = H()
    h.apply_file(str(pbf), locations=True, idx="flex_mem")
    return h.items


def main(argv=None) -> int:
    c.setup_logging()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", default=".local_storage/risk/shelters.json")
    a = p.parse_args(argv)
    import numpy as np

    if not pf.PBF.exists():
        sys.exit(f"missing {pf.PBF}; download https://download.geofabrik.de/asia/thailand-latest.osm.pbf")
    t0 = time.time()
    items = extract(pf.PBF)
    c.log.info("%d named candidate places in the extract (%.0fs)", len(items), time.time() - t0)
    c.ee_init("")
    arr = np.array([(i[1], i[2]) for i in items])
    inside = sorted(pf.locate(arr))                       # only places inside a tambon (that is, inside Thailand)
    prod = pf.sample_prod(arr, inside)
    rows = []
    for i in inside:
        if prod.get(i, 0) < SAFE_BELOW:
            kind, lon, lat, name_en, name_th = items[i]
            rows.append([kind, round(lat, 5), round(lon, 5), name_en, name_th])
    doc = {"generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "columns": ["kind", "lat", "lng", "name", "name_th"], "safe_below_product": SAFE_BELOW,
           "source": "OpenStreetMap (Geofabrik thailand-latest), ODbL. Candidates from open data, not a confirmed list of shelters.", "places": rows}
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
    kinds = {}
    for r in rows:
        kinds[r[0]] = kinds.get(r[0], 0) + 1
    c.log.info("wrote %s: %d safe candidates %s, %.1f MB", out, len(rows), kinds, out.stat().st_size / 1e6)
    return 0


if __name__ == "__main__":
    sys.exit(main())
