"""Download Geofabrik Thailand OSM, extract roads (as ~100 m midpoint CSV per class) + facilities, upload to GCS,
ingest facilities as EE asset <folder>/facilities and road tables as <folder>/roads_<class>.

Needs the `osmium` CLI (preferred; `brew install osmium-tool`) or pyrosm. Streams geojsonseq, so memory stays low.
  cd apps/api && uv run --group scripts python ../../scripts/fetch_osm.py --bucket $PROJECT_ID-dnext
"""
import csv
import json
import math
import shutil
import subprocess
import time
from pathlib import Path

import _common as c

PBF_URL = "https://download.geofabrik.de/asia/thailand-latest.osm.pbf"
ROAD_CLASSES = ["primary", "secondary", "tertiary", "local", "track"]
PIECE_M = 100.0
_HIGHWAY_MAP = {
    "motorway": "primary", "motorway_link": "primary", "trunk": "primary", "trunk_link": "primary",
    "primary": "primary", "primary_link": "primary",
    "secondary": "secondary", "secondary_link": "secondary",
    "tertiary": "tertiary", "tertiary_link": "tertiary",
    "unclassified": "local", "residential": "local", "service": "local", "living_street": "local",
    "track": "track",
}


def highway_class(tags: dict) -> str | None:
    return _HIGHWAY_MAP.get(tags.get("highway", ""))


def facility_kind(tags: dict) -> str | None:
    """school|hospital|shelter|bridge from OSM tags, else None. bridge only when no other kind matches."""
    amenity = tags.get("amenity", "")
    if amenity == "school":
        return "school"
    if amenity in ("hospital", "clinic", "doctors"):
        return "hospital"
    if (tags.get("emergency") == "assembly_point" or amenity == "shelter"
            or (amenity == "social_facility" and tags.get("social_facility") == "shelter")):
        return "shelter"
    if tags.get("bridge") in ("yes", "viaduct", "movable", "boardwalk") or tags.get("man_made") == "bridge":
        return "bridge"
    return None


def haversine_m(a, b) -> float:
    R = 6371008.8
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp, dl = p2 - p1, math.radians(b[0] - a[0])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def line_length_m(coords) -> float:
    return sum(haversine_m(coords[i], coords[i + 1]) for i in range(len(coords) - 1))


def point_along(coords, target_m: float):
    acc = 0.0
    for i in range(len(coords) - 1):
        seg = haversine_m(coords[i], coords[i + 1])
        if acc + seg >= target_m and seg > 0:
            t = (target_m - acc) / seg
            return (coords[i][0] + t * (coords[i + 1][0] - coords[i][0]), coords[i][1] + t * (coords[i + 1][1] - coords[i][1]))
        acc += seg
    return tuple(coords[-1][:2])


def segment_midpoints(coords, piece_m: float = PIECE_M) -> list[tuple[float, float, float]]:
    """Split a line into ~piece_m pieces -> [(lon, lat, len_m)] at each piece midpoint. Sum of len_m == line length."""
    total = line_length_m(coords)
    if total <= 0:
        return []
    n = max(1, math.ceil(total / piece_m))
    each = total / n
    return [(*point_along(coords, (i + 0.5) * each), each) for i in range(n)]


def representative_point(geom: dict):
    t, co = geom["type"], geom["coordinates"]
    if t == "Point":
        return co[0], co[1]
    if t == "LineString":
        return point_along(co, line_length_m(co) / 2)
    ring = co[0] if t == "Polygon" else co[0][0] if t == "MultiPolygon" else None
    if ring is None:
        return None
    return sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)


def download_pbf(dest: Path) -> Path:
    if dest.exists():
        c.log.info("pbf exists, skipping download: %s", dest)
        return dest
    import httpx
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    with httpx.stream("GET", PBF_URL, follow_redirects=True, timeout=None) as r, open(tmp, "wb") as f:
        r.raise_for_status()
        for chunk in r.iter_bytes(1 << 20):
            f.write(chunk)
    tmp.rename(dest)
    return dest


def pbf_date(pbf: Path) -> str:
    """Date of the extract: osmium fileinfo timestamp if available, else file mtime."""
    if shutil.which("osmium"):
        r = subprocess.run(["osmium", "fileinfo", "-g", "header.option.osmosis_replication_timestamp", str(pbf)],
                           capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()[:10]
    return time.strftime("%Y-%m-%d", time.gmtime(pbf.stat().st_mtime))


def iter_features_osmium(pbf: Path, work: Path):
    """Yield GeoJSON features (with tags as properties) for highways and facility-ish objects, streamed."""
    filt = work / "filtered.osm.pbf"
    seq = work / "features.geojsonseq"
    subprocess.run(["osmium", "tags-filter", "-o", str(filt), "--overwrite", str(pbf),
                    "w/highway", "nwr/amenity=school,hospital,clinic,doctors,shelter,social_facility",
                    "nwr/emergency=assembly_point", "w/bridge", "nwr/man_made=bridge"], check=True)
    subprocess.run(["osmium", "export", "-f", "geojsonseq", "--overwrite", "-o", str(seq), str(filt)], check=True)
    with open(seq, encoding="utf-8") as f:
        for line in f:
            line = line.lstrip("\x1e").strip()
            if line:
                yield json.loads(line)


def iter_features_pyrosm(pbf: Path):
    from pyrosm import OSM
    osm = OSM(str(pbf))
    net = osm.get_network(network_type="all", extra_attributes=["bridge"])
    for _, row in net.iterrows():
        yield {"type": "Feature", "geometry": row.geometry.__geo_interface__,
               "properties": {k: v for k, v in row.items() if k != "geometry" and v is not None}}
    pois = osm.get_pois(custom_filter={"amenity": ["school", "hospital", "clinic", "doctors", "shelter", "social_facility"],
                                       "emergency": ["assembly_point"]})
    if pois is not None:
        for _, row in pois.iterrows():
            yield {"type": "Feature", "geometry": row.geometry.__geo_interface__,
                   "properties": {k: v for k, v in row.items() if k != "geometry" and v is not None}}


def extract(pbf: Path, out: Path):
    out.mkdir(parents=True, exist_ok=True)
    feats = iter_features_osmium(pbf, out) if shutil.which("osmium") else iter_features_pyrosm(pbf)
    writers = {k: open(out / f"roads_{k}.csv", "w", newline="", encoding="utf-8") for k in ROAD_CLASSES}
    csvs = {k: csv.writer(w) for k, w in writers.items()}
    for w in csvs.values():
        w.writerow(["lon", "lat", "len_m"])
    facilities, counts = [], {k: 0 for k in ROAD_CLASSES}
    for ft in feats:
        geom, tags = ft.get("geometry"), ft.get("properties") or {}
        if not geom:
            continue
        cls = highway_class(tags)
        if cls and geom["type"] == "LineString":
            for lon, lat, ln in segment_midpoints(geom["coordinates"]):
                csvs[cls].writerow([round(lon, 6), round(lat, 6), round(ln, 1)])
                counts[cls] += 1
        elif cls and geom["type"] == "MultiLineString":
            for part in geom["coordinates"]:
                for lon, lat, ln in segment_midpoints(part):
                    csvs[cls].writerow([round(lon, 6), round(lat, 6), round(ln, 1)])
                    counts[cls] += 1
        kind = facility_kind(tags)
        if kind and not (cls and kind != "bridge"):
            if kind == "bridge" and not cls:
                continue
            pt = representative_point(geom)
            if pt:
                facilities.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(pt[0], 6), round(pt[1], 6)]},
                                   "properties": {"name": tags.get("name") or tags.get("name:en") or "", "kind": kind}})
    for w in writers.values():
        w.close()
    (out / "facilities.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": facilities}, ensure_ascii=False))
    c.log.info("road pieces: %s; facilities: %d", counts, len(facilities))
    return counts, len(facilities)


def main(argv=None):
    c.setup_logging()
    p = c.base_parser(__doc__)
    p.add_argument("--pbf", type=Path, default=c.OUT_DIR / "osm" / "thailand-latest.osm.pbf")
    p.add_argument("--bucket", help="GCS bucket (default $PROJECT_ID-dnext)")
    p.add_argument("--skip-upload", action="store_true")
    a = p.parse_args(argv)
    project = c.require_project(a.project, a.dry_run)
    import os
    bucket = a.bucket or f"{os.environ.get('PROJECT_ID', project)}-dnext"
    folder = c.asset_folder(project)
    if a.dry_run:
        print(f"[dry-run] download {PBF_URL} -> {a.pbf} (skip if exists); extract roads {ROAD_CLASSES} + facilities; "
              f"upload to gs://{bucket}/osm/; ingest {folder}/facilities and {folder}/roads_<class>")
        return 0
    pbf = download_pbf(a.pbf)
    osm_date = pbf_date(pbf)
    out = a.pbf.parent / "extract"
    extract(pbf, out)
    (out / "osm_date.txt").write_text(osm_date)
    c.update_assets_local("osm_date", osm_date)
    if a.skip_upload:
        return 0
    from google.cloud import storage
    bkt = storage.Client().bucket(bucket)
    for f in sorted(out.glob("*.csv")) + [out / "facilities.geojson"]:
        bkt.blob(f"osm/{f.name}").upload_from_filename(str(f))
        c.log.info("uploaded gs://%s/osm/%s", bucket, f.name)
    c.ee_init(a.project)
    c.ensure_folder(a.project)
    for cls in ROAD_CLASSES:
        aid = f"{folder}/roads_{cls}"
        if c.delete_asset_if(aid, a.overwrite):
            c.ingest_table_and_wait(aid, [f"gs://{bucket}/osm/roads_{cls}.csv"], {"xColumn": "lon", "yColumn": "lat"})
        print(f"ASSET {aid}")
    fid = f"{folder}/facilities"
    if c.delete_asset_if(fid, a.overwrite):
        c.ingest_table_and_wait(fid, [f"gs://{bucket}/osm/facilities.geojson"])
    c.record_asset("facilities_asset", fid)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
