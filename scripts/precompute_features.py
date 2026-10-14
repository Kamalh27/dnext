"""One-off precompute of 'what is in the risk zone': per-tambon histograms (by static risk product 0..125) of
 - built-up area (GHSL 2020, m2)  -> estimated buildings = built m2 / average footprint
 - hospitals (OSM amenity=hospital), schools (OSM amenity=school)
 - main roads (OSM highway motorway..tertiary incl. links), in km
Because a scenario only supplies ONE trigger number per tambon, the numbers inside any scenario's elevated-risk zone then follow in
Python (see app/geo/static_stats.py) with no Earth Engine or OSM call.

Steps (cached under scripts/out/features/, rerunnable): geoms -> osm -> sample -> ghsl -> merge
  cd apps/api && uv run --group scripts python ../../scripts/precompute_features.py --steps geoms,osm,sample,ghsl,merge
Needs: risk_static_asset (scripts/build_risk_layer.py) and the Geofabrik extract scripts/out/osm/thailand-latest.osm.pbf
(https://download.geofabrik.de/asia/thailand-latest.osm.pbf).  OSM data (c) OpenStreetMap contributors, ODbL.
"""
import argparse
import json
import math
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as c  # noqa: E402

OUT = Path(__file__).resolve().parent / "out" / "features"
PBF = Path(__file__).resolve().parent / "out" / "osm" / "thailand-latest.osm.pbf"
MAIN_ROADS = {"motorway", "trunk", "primary", "secondary", "tertiary"}      # + *_link
SPACING_M = 250.0
CHUNK = 4000


# ---------------------------------------------------------------- step 1: simplified tambon polygons (local lookup)
def step_geoms() -> None:
    import ee
    from app.geo import tambon_risk
    from app.geo.ee_init import get_info
    thr = ee.FeatureCollection(tambon_risk.cfg()["assets"]["thresholds"])
    provinces = sorted(get_info(thr.aggregate_array("adm1_pcode").distinct()))

    def one(pc: str) -> list:
        fc = thr.filter(ee.Filter.eq("adm1_pcode", pc)).select(["adm3_pcode"])
        fc = fc.map(lambda f: ee.Feature(f.geometry().simplify(150), {"adm3_pcode": f.get("adm3_pcode")}))
        feats = get_info(fc.toList(10000))
        c.log.info("  geoms %s: %d tambons", pc, len(feats))
        return [{"code": f["properties"]["adm3_pcode"], "geometry": f["geometry"]} for f in feats]

    out = []
    with ThreadPoolExecutor(max_workers=4) as ex:
        for part in ex.map(one, provinces):
            out += part
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "tambon_geoms.json").write_text(json.dumps(out, separators=(",", ":")))
    c.log.info("wrote tambon_geoms.json: %d tambons", len(out))


# ---------------------------------------------------------------- step 2: OSM extract -> points
def step_osm() -> None:
    import osmium
    if not PBF.exists():
        sys.exit(f"missing {PBF}; download https://download.geofabrik.de/asia/thailand-latest.osm.pbf")

    def hav(a, b) -> float:
        dx = (b[0] - a[0]) * 111320.0 * math.cos(math.radians((a[1] + b[1]) / 2))
        dy = (b[1] - a[1]) * 110540.0
        return math.hypot(dx, dy)

    class H(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.hosp, self.school, self.road = [], [], []
            self.road_km = 0.0

        def node(self, n):
            a = n.tags.get("amenity")
            if a == "hospital":
                self.hosp.append((n.location.lon, n.location.lat))
            elif a == "school":
                self.school.append((n.location.lon, n.location.lat))

        def way(self, w):
            hw = w.tags.get("highway")
            if hw and hw.removesuffix("_link") in MAIN_ROADS:
                pts = []
                for nd in w.nodes:
                    if nd.location.valid():
                        pts.append((nd.location.lon, nd.location.lat))
                if len(pts) < 2:
                    return
                seg = [hav(a, b) for a, b in zip(pts, pts[1:])]
                total = sum(seg)
                if total <= 0:
                    return
                n = max(1, round(total / SPACING_M))
                w_km = total / n / 1000.0
                self.road_km += total / 1000.0
                for k in range(n):                      # n points at the middle of n equal pieces, each weighing 1/n of the way
                    target, acc = (k + 0.5) * total / n, 0.0
                    for i, sl in enumerate(seg):
                        if acc + sl >= target:
                            f = (target - acc) / sl if sl else 0.0
                            self.road.append((pts[i][0] + f * (pts[i + 1][0] - pts[i][0]), pts[i][1] + f * (pts[i + 1][1] - pts[i][1]), w_km))
                            break
                        acc += sl
                return
            a = w.tags.get("amenity")
            if a in ("hospital", "school"):             # building/area ways: use the first node as a representative point
                nd = next((x for x in w.nodes if x.location.valid()), None)
                if nd:
                    (self.hosp if a == "hospital" else self.school).append((nd.location.lon, nd.location.lat))

    h = H()
    t0 = time.time()
    h.apply_file(str(PBF), locations=True, idx="flex_mem")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "osm_points.json").write_text(json.dumps({"hospital": h.hosp, "school": h.school, "road": h.road, "road_km_total": h.road_km},
                                                    separators=(",", ":")))
    c.log.info("OSM: %d hospital points, %d school points, %d road samples (%.0f km main roads) in %.0fs",
               len(h.hosp), len(h.school), len(h.road), h.road_km, time.time() - t0)


# ---------------------------------------------------------------- step 3: tambon + prod for every point
def step_sample() -> None:
    import ee
    import numpy as np
    from shapely import STRtree, points
    from shapely.geometry import shape
    from app.geo import tambon_risk
    from app.geo.ee_init import get_info

    geoms = json.loads((OUT / "tambon_geoms.json").read_text())
    shapes = [shape(g["geometry"]) for g in geoms]
    codes = [g["code"] for g in geoms]
    tree = STRtree(shapes)
    osm = json.loads((OUT / "osm_points.json").read_text())
    pts = [("hospital", lon, lat, 1.0) for lon, lat in osm["hospital"]] + [("school", lon, lat, 1.0) for lon, lat in osm["school"]] \
        + [("road", lon, lat, w) for lon, lat, w in osm["road"]]
    arr = np.array([(p[1], p[2]) for p in pts])
    pg = points(arr[:, 0], arr[:, 1])
    pi, ti = tree.query(pg, predicate="intersects")           # (point index, tambon index) pairs; first match wins
    first = {}
    for a, b in zip(pi, ti):
        first.setdefault(int(a), int(b))
    inside = sorted(first)
    c.log.info("%d of %d points fall inside a tambon", len(inside), len(pts))

    s = tambon_risk.static_stats_bands().select("prod").unmask(0).toInt()
    chunks = [inside[i:i + CHUNK] for i in range(0, len(inside), CHUNK)]

    def sample(chunk):
        feats = [ee.Feature(ee.Geometry.Point([float(arr[i, 0]), float(arr[i, 1])]), {"i": int(i)}) for i in chunk]
        res = get_info(s.sampleRegions(collection=ee.FeatureCollection(feats), properties=["i"], scale=tambon_risk.STATS_SCALE_M, tileScale=4))
        return {int(f["properties"]["i"]): int(f["properties"]["prod"]) for f in res["features"]} if isinstance(res, dict) else \
            {int(f["properties"]["i"]): int(f["properties"]["prod"]) for f in res}

    prod = {}
    done = 0
    with ThreadPoolExecutor(max_workers=4) as ex:
        for part in ex.map(sample, chunks):
            prod.update(part)
            done += 1
            if done % 20 == 0:
                c.log.info("  sampled %d/%d chunks", done, len(chunks))
    agg: dict = {}
    for i in inside:
        kind, _, _, w = pts[i]
        slot = agg.setdefault(codes[first[i]], {}).setdefault(str(prod.get(i, 0)), {"hospital": 0.0, "school": 0.0, "road_km": 0.0})
        slot["road_km" if kind == "road" else kind] += w
    (OUT / "points_by_tambon_prod.json").write_text(json.dumps(agg, separators=(",", ":")))
    c.log.info("wrote points_by_tambon_prod.json for %d tambons", len(agg))


# ---------------------------------------------------------------- step 4: GHSL built-up histogram
def step_ghsl() -> None:
    import ee
    from app.geo import tambon_risk
    from app.geo.ee_init import get_info
    thr = ee.FeatureCollection(tambon_risk.cfg()["assets"]["thresholds"])
    provinces = sorted(get_info(thr.aggregate_array("adm1_pcode").distinct()))
    ghsl = ee.ImageCollection("JRC/GHSL/P2023A/GHS_BUILT_S").filter(ee.Filter.eq("system:index", "2020")).first().select("built_surface")
    img = ee.Image.cat([ghsl.unmask(0).rename("built"), tambon_risk.static_stats_bands().select("prod").unmask(0).toInt().rename("prod")])

    def one(pc: str) -> dict:
        fc = thr.filter(ee.Filter.eq("adm1_pcode", pc))
        red = img.reduceRegions(collection=fc, reducer=ee.Reducer.sum().group(groupField=1, groupName="prod"), scale=tambon_risk.STATS_SCALE_M, tileScale=4)
        rows = get_info(red.select(["adm3_pcode", "groups"], retainGeometry=False).toList(10000))
        c.log.info("  ghsl %s: %d tambons", pc, len(rows))
        return {r["properties"]["adm3_pcode"]: {str(int(g["prod"])): round(g["sum"], 1) for g in (r["properties"].get("groups") or [])} for r in rows}

    out: dict = {}
    with ThreadPoolExecutor(max_workers=5) as ex:
        for part in ex.map(one, provinces):
            out.update(part)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "ghsl_by_tambon_prod.json").write_text(json.dumps(out, separators=(",", ":")))
    c.log.info("wrote ghsl_by_tambon_prod.json for %d tambons", len(out))


# ---------------------------------------------------------------- step 5: merge
def step_merge(out_path: Path) -> None:
    pts = json.loads((OUT / "points_by_tambon_prod.json").read_text())
    ghsl = json.loads((OUT / "ghsl_by_tambon_prod.json").read_text())
    tambon: dict = {}
    for code in set(pts) | set(ghsl):
        h: dict = {}
        for p, built in ghsl.get(code, {}).items():
            h.setdefault(p, [0.0, 0.0, 0.0, 0.0])[0] = built
        for p, v in pts.get(code, {}).items():
            slot = h.setdefault(p, [0.0, 0.0, 0.0, 0.0])
            slot[1], slot[2], slot[3] = v["hospital"], v["school"], round(v["road_km"], 3)
        tambon[code] = {"h": h}
    doc = {"generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "columns": ["built_m2", "hospitals", "schools", "road_km"],
           "sources": {"built": "JRC GHSL P2023A GHS_BUILT_S 2020 (100 m)", "poi_roads": "OpenStreetMap (Geofabrik thailand-latest), ODbL",
                       "roads": "highway=motorway|trunk|primary|secondary|tertiary (+_link), sampled every 250 m", "hospitals": "amenity=hospital",
                       "schools": "amenity=school"},
           "tambon": tambon}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(doc, separators=(",", ":")))
    tot = [sum(v[i] for t in tambon.values() for v in t["h"].values()) for i in range(4)]
    c.log.info("wrote %s (%d tambons, %.1f MB) totals: built %.0f km2, hospitals %.0f, schools %.0f, roads %.0f km",
               out_path, len(tambon), out_path.stat().st_size / 1e6, tot[0] / 1e6, tot[1], tot[2], tot[3])


def main(argv=None) -> int:
    c.setup_logging()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--steps", default="geoms,osm,sample,ghsl,merge")
    p.add_argument("--out", default=".local_storage/risk/static_features.json")
    a = p.parse_args(argv)
    steps = a.steps.split(",")
    if set(steps) & {"geoms", "sample", "ghsl"}:
        c.ee_init("")
    fns = {"geoms": step_geoms, "osm": step_osm, "sample": step_sample, "ghsl": step_ghsl, "merge": lambda: step_merge(Path(a.out))}
    for s in steps:
        c.log.info("== step %s", s)
        fns[s]()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
