"""Thailand admin boundaries -> EE FeatureCollection asset <folder>/tambon + apps/api/app/config/admin_index.json.

Primary source: HDX cod-ab-tha shapefile zip (download manually:
  https://data.humdata.org/dataset/cod-ab-tha  -> "tha_admin_boundaries.shp.zip") or pass --url.
  cd apps/api && uv run --group scripts python ../../scripts/upload_admin.py --zip ~/Downloads/tha_admin_boundaries.shp.zip --bucket $PROJECT_ID-dnext
Fallback (no HDX file): --fallback geoboundaries  (ADM1+ADM2 only; records 'tambon level unavailable').
"""
import json
import math
import re
import tempfile
import zipfile
from pathlib import Path

import _common as c

SIMPLIFY_M = 100
INDEX_PATH = c.CONFIG_DIR / "admin_index.json"
LEVELS = (1, 2, 3)


def _bbox_of(geom: dict) -> list[float]:
    xs, ys = [], []

    def walk(o):
        if isinstance(o[0], (int, float)):
            xs.append(o[0]); ys.append(o[1])
        else:
            for x in o:
                walk(x)
    walk(geom["coordinates"])
    return [round(min(xs), 5), round(min(ys), 5), round(max(xs), 5), round(max(ys), 5)]


def _rings(geom: dict):
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    for poly in polys:
        yield from poly


def point_in_geom(lon: float, lat: float, geom: dict) -> bool:
    """Ray casting over all rings (even-odd), enough for parent assignment."""
    inside = False
    for ring in _rings(geom):
        n = len(ring)
        for i in range(n):
            x1, y1 = ring[i][:2]
            x2, y2 = ring[(i + 1) % n][:2]
            if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
                inside = not inside
    return inside


def build_admin_index(records: list[dict]) -> list[dict]:
    """records: dicts with level, pcode, name_en, name_th, parent_pcode (optional), geometry (GeoJSON dict).
    Returns the compact index: level, pcode, name_en, name_th, bbox, centroid, parent_pcode. No geometry kept."""
    out = []
    for r in records:
        bbox = _bbox_of(r["geometry"])
        out.append({
            "level": int(r["level"]), "pcode": r["pcode"],
            "name_en": r.get("name_en") or "", "name_th": r.get("name_th") or "",
            "bbox": bbox, "centroid": [round((bbox[0] + bbox[2]) / 2, 5), round((bbox[1] + bbox[3]) / 2, 5)],
            "parent_pcode": r.get("parent_pcode") or None,
        })
    out.sort(key=lambda d: (d["level"], d["pcode"]))
    return out


def gdf_to_records(gdf, level: int) -> list[dict]:
    """Map an HDX cod-ab-tha layer (ADM{level}_PCODE, ADM{level}_EN, ADM{level}_TH, ADM{level-1}_PCODE) to records."""
    cols = {k.upper(): k for k in gdf.columns}
    g = lambda row, name: row[cols[name]] if name in cols and row[cols[name]] is not None else ""
    recs = []
    for _, row in gdf.iterrows():
        recs.append({
            "level": level, "pcode": str(g(row, f"ADM{level}_PCODE")),
            "name_en": str(g(row, f"ADM{level}_EN")), "name_th": str(g(row, f"ADM{level}_TH")),
            "parent_pcode": str(g(row, f"ADM{level - 1}_PCODE")) if level > 1 else None,
            "geometry": json.loads(json.dumps(row.geometry.__geo_interface__)),
        })
    return recs


def read_hdx(zip_path: Path, workdir: Path):
    import geopandas as gpd
    names = zipfile.ZipFile(zip_path).namelist()
    layers = {}
    for lvl in LEVELS:
        cand = [n for n in names if n.lower().endswith(".shp") and re.search(rf"adm{lvl}(?!\d)", n.lower())
                and "adm%dd" % lvl not in n.lower()]
        if not cand:
            raise SystemExit(f"no ADM{lvl} shapefile in {zip_path}")
        layers[lvl] = gpd.read_file(f"zip://{zip_path}!{sorted(cand, key=len)[0]}", engine="pyogrio").to_crs(4326)
        c.log.info("ADM%d: %d features", lvl, len(layers[lvl]))
    return layers


def simplify_gdf(gdf, tol_m: float = SIMPLIFY_M):
    g = gdf.to_crs(32647).copy()
    g["geometry"] = g.geometry.simplify(tol_m, preserve_topology=True)
    return g.to_crs(4326)


def main(argv=None):
    c.setup_logging()
    p = c.base_parser(__doc__)
    p.add_argument("--zip", type=Path, help="HDX cod-ab-tha shapefile zip")
    p.add_argument("--url", help="download the HDX zip from this URL")
    p.add_argument("--bucket", help="GCS bucket for the GeoJSON staging file (default $PROJECT_ID-dnext)")
    p.add_argument("--fallback", choices=["geoboundaries"], help="use EE geoBoundaries ADM1/2 (no tambon)")
    a = p.parse_args(argv)
    project = c.require_project(a.project, a.dry_run)
    asset_id = f"{c.asset_folder(project)}/tambon"

    if a.fallback:
        return run_fallback(a, project, asset_id)
    if a.url and not a.zip:
        a.zip = Path(tempfile.mkdtemp()) / "hdx_tha.zip"
        if a.dry_run:
            print(f"[dry-run] would download {a.url}")
        else:
            import httpx
            with httpx.stream("GET", a.url, follow_redirects=True, timeout=300) as r, open(a.zip, "wb") as f:
                r.raise_for_status()
                for chunk in r.iter_bytes():
                    f.write(chunk)
    if not a.zip or (not a.zip.exists() and not a.dry_run):
        raise SystemExit("HDX file missing: pass --zip PATH (manual download, see docstring) or --url, or --fallback geoboundaries")
    if a.dry_run:
        print(f"[dry-run] would convert {a.zip} (simplify {SIMPLIFY_M} m) -> GCS -> {asset_id}; write {INDEX_PATH}")
        return 0

    layers = read_hdx(a.zip, c.OUT_DIR)
    records = []
    for lvl, gdf in layers.items():
        records += gdf_to_records(simplify_gdf(gdf) if lvl == 3 else gdf, lvl)
    # ADM1/2 index records carry real geometry only for bbox; ADM3 geometry dropped by build_admin_index.
    index = build_admin_index(records)
    INDEX_PATH.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")))
    c.log.info("wrote %s (%d records)", INDEX_PATH, len(index))

    # EE asset: simplified ADM3 as GeoJSON with full attributes
    c.OUT_DIR.mkdir(parents=True, exist_ok=True)
    gj = c.OUT_DIR / "tambon.geojson"
    simplify_gdf(layers[3]).to_file(gj, driver="GeoJSON", engine="pyogrio")
    c.ee_init(a.project)
    c.ensure_folder(a.project)
    if not c.delete_asset_if(asset_id, a.overwrite):
        c.record_asset("tambon_asset", asset_id)
        return 0
    import os
    from google.cloud import storage
    bucket = a.bucket or f"{os.environ.get('PROJECT_ID', project)}-dnext"
    blob = storage.Client().bucket(bucket).blob("admin/tambon.geojson")
    blob.upload_from_filename(str(gj))
    c.ingest_table_and_wait(asset_id, [f"gs://{bucket}/admin/tambon.geojson"])
    c.record_asset("tambon_asset", asset_id)
    return 0


def run_fallback(a, project, asset_id):
    if a.dry_run:
        print(f"[dry-run] would export geoBoundaries THA ADM2 (+ADM1 index) to {asset_id}; limitation: tambon level unavailable")
        return 0
    ee = c.ee_init(a.project)
    c.ensure_folder(a.project)
    src = "WM/geoLab/geoBoundaries/600/ADM"
    adm1 = ee.FeatureCollection(src + "1").filter(ee.Filter.eq("shapeGroup", "THA")).getInfo()["features"]
    adm2_fc = ee.FeatureCollection(src + "2").filter(ee.Filter.eq("shapeGroup", "THA"))
    adm2 = adm2_fc.getInfo()["features"]
    recs = []
    for f in adm1:
        recs.append({"level": 1, "pcode": f["properties"]["shapeID"], "name_en": f["properties"]["shapeName"], "geometry": f["geometry"]})
    for f in adm2:
        lon, lat = [(_bbox_of(f["geometry"])[i] + _bbox_of(f["geometry"])[i + 2]) / 2 for i in (0, 1)]
        parent = next((r["pcode"] for r in recs if r["level"] == 1 and point_in_geom(lon, lat, r["geometry"])), None)
        recs.append({"level": 2, "pcode": f["properties"]["shapeID"], "name_en": f["properties"]["shapeName"],
                     "parent_pcode": parent, "geometry": f["geometry"]})
    INDEX_PATH.write_text(json.dumps(build_admin_index(recs), ensure_ascii=False, separators=(",", ":")))
    c.log.info("wrote %s", INDEX_PATH)
    if c.delete_asset_if(asset_id, a.overwrite):
        fc = adm2_fc.map(lambda f: f.select(["shapeID", "shapeName"], ["ADM2_PCODE", "name_en"]))
        c.start_export_and_wait(ee.batch.Export.table.toAsset(fc, "dnext_admin_fallback", asset_id))
    c.record_asset("tambon_asset", asset_id)
    c.update_assets_local("admin_limitation", "tambon level unavailable (geoBoundaries ADM2 used)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
