"""One-off: simplified tambon outlines, grouped by province, for the map in the report.

Reads the tambon polygons cached by scripts/precompute_features.py (step `geoms`), simplifies them a little more and rounds the
coordinates, and writes `.local_storage/risk/tambon_shapes.json`:  {"TH50": {"TH500101": {"type": "Polygon", "coordinates": [...]}, ...}, ...}
The API serves one province at a time (GET /geo/tambons/{pcode}).

  cd apps/api && uv run --group scripts python ../../scripts/build_tambon_shapes.py
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as c  # noqa: E402
import precompute_features as pf  # noqa: E402


def _round(coords, nd=4):
    return [round(coords[0], nd), round(coords[1], nd)] if isinstance(coords[0], (int, float)) else [_round(x, nd) for x in coords]


def main(argv=None) -> int:
    c.setup_logging()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", default=".local_storage/risk/tambon_shapes.json")
    p.add_argument("--tolerance", type=float, default=0.0008, help="simplification tolerance in degrees (about 90 m)")
    a = p.parse_args(argv)
    from shapely.geometry import mapping, shape
    from shapely.ops import unary_union

    src = pf.OUT / "tambon_geoms.json"
    if not src.exists():
        sys.exit(f"missing {src}; run scripts/precompute_features.py --steps geoms first")
    out: dict = {}
    n = 0
    for g in json.loads(src.read_text()):
        geom = shape(g["geometry"]).simplify(a.tolerance, preserve_topology=True)
        if geom.geom_type == "GeometryCollection":          # keep the polygon parts only
            geom = unary_union([x for x in geom.geoms if x.geom_type in ("Polygon", "MultiPolygon")])
        if geom.is_empty or geom.geom_type not in ("Polygon", "MultiPolygon"):
            continue
        m = mapping(geom)
        out.setdefault(g["code"][:4], {})[g["code"]] = {"type": m["type"], "coordinates": _round(m["coordinates"])}
        n += 1
    path = Path(a.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, separators=(",", ":")))
    c.log.info("wrote %s: %d tambons in %d provinces, %.1f MB", path, n, len(out), path.stat().st_size / 1e6)
    return 0


if __name__ == "__main__":
    sys.exit(main())
