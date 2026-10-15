"""One-off precompute of the buildings and main roads that can end up in a Moderate-or-higher risk zone.

risk = trigger x product / 125 and the trigger is at most 5, so only ground with a static product of at least 50 can ever reach a risk
of 2 (Moderate). The script keeps what stands on that ground:
  buildings: Google Open Buildings (Earth Engine, confidence >= 0.7): location, footprint area and an estimated height (JRC GHSL built height, 100 m)
  roads: OpenStreetMap main roads (motorway to tertiary), cut into ~250 m pieces
At request time the API picks, for each tambon, the pieces whose risk (tambon trigger x product / 125) reaches the elevated value
(app/geo/static_stats.py, GET /infrastructure/{scenario_id}).

  cd apps/api && uv run --group scripts python ../../scripts/precompute_infrastructure.py [--provinces TH50,TH55] [--steps cells,buildings,roads,merge]
Needs the cached tambon polygons from scripts/precompute_features.py (step `geoms`), the risk_static_asset and, for roads, the Geofabrik extract.
Earth Engine data: Google Open Buildings v3 and JRC GHSL (see their licences); OSM data (c) OpenStreetMap contributors, ODbL.
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
import precompute_features as pf  # noqa: E402

MIN_PROD = 50
CELL_CHUNK = 100          # cells per Earth Engine request for the buildings
HALF = 0.0006             # degrees, a little more than half of a 100 m cell
SPACING_M = 250.0
CACHE = pf.OUT.parent / "infra"
MAIN_ROADS = pf.MAIN_ROADS


def _images():
    import ee
    from app.geo import tambon_risk

    prod = tambon_risk.static_stats_bands().select("prod").unmask(0).toInt()
    built = ee.ImageCollection("JRC/GHSL/P2023A/GHS_BUILT_S").filter(ee.Filter.eq("system:index", "2020")).first().select("built_surface").unmask(0)
    height = ee.Image("JRC/GHSL/P2023A/GHS_BUILT_H/2018").select("built_height").unmask(0)
    return prod, built, height


# ---------------------------------------------------------------- step 1: 100 m cells that can reach Moderate and hold buildings
def step_cells(provinces: list[str] | None) -> None:
    import ee
    from app.geo import tambon_risk
    from app.geo.ee_init import get_info

    CACHE.mkdir(parents=True, exist_ok=True)
    thr = ee.FeatureCollection(tambon_risk.cfg()["assets"]["thresholds"])
    todo = provinces or sorted(get_info(thr.aggregate_array("adm1_pcode").distinct()))
    prod, built, height = _images()
    img = ee.Image.cat([prod.rename("prod"), height.rename("h")]).updateMask(prod.gte(MIN_PROD).And(built.gt(0)))

    def one(pc: str) -> None:
        out = CACHE / f"cells_{pc}.json"
        if out.exists():
            return
        region = thr.filter(ee.Filter.eq("adm1_pcode", pc)).geometry()
        rows = get_info(img.sample(region=region, scale=tambon_risk.STATS_SCALE_M, geometries=True, tileScale=4).toList(5000))
        if len(rows) >= 5000:
            c.log.warning("%s: 5000 cells, the list may be cut", pc)
        cells = [[round(r["geometry"]["coordinates"][0], 5), round(r["geometry"]["coordinates"][1], 5), int(r["properties"]["prod"]), float(r["properties"]["h"])] for r in rows]
        out.write_text(json.dumps(cells, separators=(",", ":")))
        c.log.info("  cells %s: %d", pc, len(cells))

    with ThreadPoolExecutor(max_workers=4) as ex:
        list(ex.map(one, todo))


def _cell_files(provinces: list[str] | None) -> list[Path]:
    files = sorted(CACHE.glob("cells_TH*.json"))
    return [f for f in files if not provinces or f.stem.split("_")[1] in provinces]


# ---------------------------------------------------------------- step 2: Open Buildings inside those cells
def step_buildings(provinces: list[str] | None) -> None:
    import ee
    from app.geo import tambon_risk
    from app.geo.ee_init import get_info

    prod, _, height = _images()
    sample_img = ee.Image.cat([prod.rename("prod"), height.rename("h")])
    ob = ee.FeatureCollection("GOOGLE/Research/open-buildings/v3/polygons")

    def chunk_job(args):
        pc, i, chunk = args
        out = CACHE / f"buildings_{pc}_{i:03d}.json"
        if out.exists():
            return
        squares = ee.FeatureCollection([ee.Feature(ee.Geometry.Rectangle([x - HALF, y - HALF, x + HALF, y + HALF])) for x, y, _, _ in chunk])
        pts = ob.filterBounds(squares).filter(ee.Filter.gte("confidence", 0.7)).map(lambda f: ee.Feature(f.geometry().centroid(1), {"a": f.get("area_in_meters")}))
        rows = get_info(sample_img.sampleRegions(collection=pts, properties=["a"], scale=tambon_risk.STATS_SCALE_M, tileScale=4, geometries=True).toList(5000))
        if len(rows) >= 5000:
            c.log.warning("%s chunk %d: 5000 buildings, the list may be cut", pc, i)
        keep = [[round(r["geometry"]["coordinates"][1], 5), round(r["geometry"]["coordinates"][0], 5), round(float(r["properties"]["a"])), float(r["properties"]["h"]),
                 int(r["properties"]["prod"])] for r in rows if int(r["properties"]["prod"]) >= MIN_PROD]
        out.write_text(json.dumps(keep, separators=(",", ":")))
        c.log.info("  buildings %s chunk %d: %d", pc, i, len(keep))

    jobs = []
    for f in _cell_files(provinces):
        pc = f.stem.split("_")[1]
        cells = json.loads(f.read_text())
        jobs += [(pc, i, cells[k:k + CELL_CHUNK]) for i, k in enumerate(range(0, len(cells), CELL_CHUNK))]
    c.log.info("%d building requests", len(jobs))
    with ThreadPoolExecutor(max_workers=4) as ex:
        list(ex.map(chunk_job, jobs))


# ---------------------------------------------------------------- step 3: OSM main roads on those cells
def step_roads(provinces: list[str] | None) -> None:
    import osmium

    if not pf.PBF.exists():
        sys.exit(f"missing {pf.PBF}; download https://download.geofabrik.de/asia/thailand-latest.osm.pbf")
    grid: dict = {}
    for f in _cell_files(provinces):
        for x, y, p, _ in json.loads(f.read_text()):
            grid.setdefault((int(x / 0.0012), int(y / 0.0012)), []).append((x, y, p))

    def prod_near(x: float, y: float) -> int:
        gx, gy = int(x / 0.0012), int(y / 0.0012)
        best = 0
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for cx, cy, p in grid.get((gx + dx, gy + dy), ()):
                    if abs(cx - x) < 0.0007 and abs(cy - y) < 0.0007 and p > best:      # within about 70 m
                        best = p
        return best

    def hav(a, b) -> float:
        dx = (b[0] - a[0]) * 111320.0 * math.cos(math.radians((a[1] + b[1]) / 2))
        dy = (b[1] - a[1]) * 110540.0
        return math.hypot(dx, dy)

    class H(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.pieces: list = []

        def way(self, w):
            hw = w.tags.get("highway")
            if not hw or hw.removesuffix("_link") not in MAIN_ROADS:
                return
            pts = [(nd.location.lon, nd.location.lat) for nd in w.nodes if nd.location.valid()]
            if len(pts) < 2:
                return
            seg = [hav(a, b) for a, b in zip(pts, pts[1:])]
            total = sum(seg)
            if total <= 0:
                return
            n = max(1, round(total / SPACING_M))
            at = lambda d: _point_at(pts, seg, d)        # noqa: E731
            for k in range(n):
                d0, d1 = k * total / n, (k + 1) * total / n
                mx, my = at((d0 + d1) / 2)
                p = prod_near(mx, my)
                if p >= MIN_PROD:
                    self.pieces.append((p, _cut(pts, seg, d0, d1)))

    h = H()
    t0 = time.time()
    h.apply_file(str(pf.PBF), locations=True, idx="flex_mem")
    (CACHE / "roads_pieces.json").write_text(json.dumps(h.pieces, separators=(",", ":")))
    c.log.info("%d road pieces on Moderate-capable ground (%.0fs)", len(h.pieces), time.time() - t0)


def _point_at(pts, seg, d):
    acc = 0.0
    for i, sl in enumerate(seg):
        if acc + sl >= d:
            f = (d - acc) / sl if sl else 0.0
            return pts[i][0] + f * (pts[i + 1][0] - pts[i][0]), pts[i][1] + f * (pts[i + 1][1] - pts[i][1])
        acc += sl
    return pts[-1]


def _cut(pts, seg, d0, d1):
    out = [_point_at(pts, seg, d0)]
    acc = 0.0
    for i, sl in enumerate(seg):
        acc += sl
        if d0 < acc < d1:
            out.append(pts[i + 1])
    out.append(_point_at(pts, seg, d1))
    return [[round(x, 5), round(y, 5)] for x, y in out]


# ---------------------------------------------------------------- step 4: group by tambon and write
def step_merge(out_path: Path, provinces: list[str] | None) -> None:
    import numpy as np

    b_rows = []
    for f in sorted(CACHE.glob("buildings_*.json")):
        if provinces and f.stem.split("_")[1] not in provinces:
            continue
        b_rows += json.loads(f.read_text())
    pieces = json.loads((CACHE / "roads_pieces.json").read_text()) if (CACHE / "roads_pieces.json").exists() else []
    c.log.info("merging %d buildings and %d road pieces", len(b_rows), len(pieces))
    buildings: dict = {}
    if b_rows:
        arr = np.array([(r[1], r[0]) for r in b_rows])
        tambon_of = pf.locate(arr)
        for i, r in enumerate(b_rows):
            if i in tambon_of:
                buildings.setdefault(tambon_of[i], []).append([r[0], r[1], r[2], r[3], r[4]])
    roads: dict = {}
    if pieces:
        mids = np.array([((p[1][0][0] + p[1][-1][0]) / 2, (p[1][0][1] + p[1][-1][1]) / 2) for p in pieces])
        tambon_of = pf.locate(mids)
        for i, (prod, line) in enumerate(pieces):
            if i in tambon_of and (not provinces or tambon_of[i][:4] in provinces):
                roads.setdefault(tambon_of[i], []).append([prod, line])
    doc = {"generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "min_prod": MIN_PROD,
           "columns": {"b": ["lat", "lng", "area_m2", "height_m", "prod"], "r": ["prod", "line [[lng, lat], ...]"]},
           "sources": {"buildings": "Google Open Buildings v3 (confidence >= 0.7), height from JRC GHSL built height 2018 (100 m)", "roads": "OpenStreetMap (Geofabrik thailand-latest), ODbL"},
           "tambon": {code: {k: v for k, v in (("b", buildings.get(code)), ("r", roads.get(code))) if v} for code in set(buildings) | set(roads)}}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(doc, separators=(",", ":")))
    c.log.info("wrote %s: %d tambons, %.1f MB", out_path, len(doc["tambon"]), out_path.stat().st_size / 1e6)


def main(argv=None) -> int:
    c.setup_logging()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--steps", default="cells,buildings,roads,merge")
    p.add_argument("--provinces", default="", help="comma separated province codes, e.g. TH50,TH55 (default: all)")
    p.add_argument("--out", default=".local_storage/risk/infrastructure.json")
    a = p.parse_args(argv)
    provinces = [x.strip().upper() for x in a.provinces.split(",") if x.strip()] or None
    steps = a.steps.split(",")
    if set(steps) & {"cells", "buildings"}:
        c.ee_init("")
    CACHE.mkdir(parents=True, exist_ok=True)
    fns = {"cells": lambda: step_cells(provinces), "buildings": lambda: step_buildings(provinces), "roads": lambda: step_roads(provinces), "merge": lambda: step_merge(Path(a.out), provinces)}
    for s in steps:
        c.log.info("== step %s", s)
        fns[s]()
    return 0


if __name__ == "__main__":
    sys.exit(main())
