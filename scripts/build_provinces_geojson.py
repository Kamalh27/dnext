"""Build simplified province outlines (77) from the tambon table, so map-click selection uses the same pcodes/names as the backend.

Output: apps/web/public/provinces.json  [{pcode, name, name_th, bbox:[w,s,e,n], geometry:{GeoJSON}}]  (~0.5-1 MB)
  cd apps/api && uv run python ../../scripts/build_provinces_geojson.py
"""
import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as c  # noqa: E402


def main(argv=None) -> int:
    c.setup_logging()
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--out", default=str(Path(__file__).resolve().parents[1] / "apps/web/public/provinces.json"))
    p.add_argument("--tolerance-m", type=int, default=1500, help="simplification tolerance")
    a = p.parse_args(argv)
    c.ee_init("")
    import ee
    from app.geo import tambon_risk
    from app.geo.ee_init import get_info

    thr = ee.FeatureCollection(tambon_risk.cfg()["assets"]["thresholds"])
    pcodes = sorted(get_info(thr.aggregate_array("adm1_pcode").distinct()))

    def one(pc: str) -> dict:
        fc = thr.filter(ee.Filter.eq("adm1_pcode", pc))
        geom = fc.geometry(maxError=a.tolerance_m).simplify(a.tolerance_m)
        names = ee.Feature(fc.first())
        info = get_info(ee.Dictionary({"g": geom, "n": names.get("adm1_name"), "t": names.get("adm1_name1"), "b": geom.bounds(maxError=100)}))
        ring = info["b"]["coordinates"][0]
        xs, ys = [q[0] for q in ring], [q[1] for q in ring]
        c.log.info("  %s %s", pc, info["n"])
        return {"pcode": pc, "name": info["n"], "name_th": info["t"], "bbox": [round(min(xs), 4), round(min(ys), 4), round(max(xs), 4), round(max(ys), 4)],
                "geometry": info["g"]}

    with ThreadPoolExecutor(max_workers=6) as ex:
        out = list(ex.map(one, pcodes))

    def r(g):   # trim coordinate precision (~11 m) to keep the file small
        if isinstance(g, list):
            return [r(x) for x in g]
        return round(g, 4) if isinstance(g, float) else g

    def polys(g):   # flatten Polygon / MultiPolygon / GeometryCollection into a list of polygon coordinate arrays
        if g["type"] == "Polygon":
            return [g["coordinates"]]
        if g["type"] == "MultiPolygon":
            return list(g["coordinates"])
        return [q for s in g.get("geometries", []) for q in polys(s)]

    for f in out:
        f["geometry"] = {"type": "MultiPolygon", "coordinates": r(polys(f["geometry"]))}
    path = Path(a.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    c.log.info("wrote %s: %d provinces, %.2f MB", path, len(out), path.stat().st_size / 1e6)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
