"""Sanity-check susceptibility S against NASA Global Landslide Catalog points (ROC-AUC) and optionally LHASA.

  cd apps/api && uv run --group scripts python ../../scripts/validate_susceptibility.py [--lhasa lhasa.tif]
Writes scripts/out/validation.md.
"""
import csv
import io
from pathlib import Path

import _common as c

GLC_URL = "https://data.nasa.gov/api/views/dd9e-wu2v/rows.csv?accessType=DOWNLOAD"
OK_ACCURACY = {"exact", "1km", "5km"}
MEKONG_BBOX = [92.0, 5.0, 110.0, 28.0]


def auc(pos: list[float], neg: list[float]) -> float:
    """ROC-AUC via the Mann-Whitney rank formula (average ranks for ties). P(score_pos > score_neg)."""
    if not pos or not neg:
        raise ValueError("need both positive and negative samples")
    allv = sorted([(v, 1) for v in pos] + [(v, 0) for v in neg], key=lambda t: t[0])
    ranks = ranks_of([v for v, _ in allv])
    r_pos = sum(r for r, (_, y) in zip(ranks, allv) if y == 1)
    n1, n0 = len(pos), len(neg)
    return (r_pos - n1 * (n1 + 1) / 2) / (n1 * n0)


def ranks_of(sorted_vals: list[float]) -> list[float]:
    """1-based average ranks for an already sorted list."""
    out, i, n = [0.0] * len(sorted_vals), 0, len(sorted_vals)
    while i < n:
        j = i
        while j + 1 < n and sorted_vals[j + 1] == sorted_vals[i]:
            j += 1
        for k in range(i, j + 1):
            out[k] = (i + j) / 2 + 1
        i = j + 1
    return out


def spearman(x: list[float], y: list[float]) -> float:
    def rk(v):
        order = sorted(range(len(v)), key=lambda i: v[i])
        rs = ranks_of([v[i] for i in order])
        res = [0.0] * len(v)
        for pos, i in enumerate(order):
            res[i] = rs[pos]
        return res
    a, b = rk(x), rk(y)
    ma, mb = sum(a) / len(a), sum(b) / len(b)
    cov = sum((p - ma) * (q - mb) for p, q in zip(a, b))
    va, vb = sum((p - ma) ** 2 for p in a), sum((q - mb) ** 2 for q in b)
    return cov / (va * vb) ** 0.5 if va and vb else float("nan")


def filter_glc(rows: list[dict], bbox: list[float]) -> list[tuple[float, float]]:
    """Thailand points with acceptable location accuracy; fall back to the Mekong bbox if fewer than 30."""
    def pts(pred):
        out = []
        for r in rows:
            try:
                lon, lat = float(r["longitude"]), float(r["latitude"])
            except (KeyError, ValueError):
                continue
            if (r.get("location_accuracy") or "").strip().lower() in OK_ACCURACY and pred(r, lon, lat):
                out.append((lon, lat))
        return out
    th = pts(lambda r, lo, la: (r.get("country_code") or "").strip().upper() == "TH")
    if len(th) >= 30:
        return th
    return pts(lambda r, lo, la: MEKONG_BBOX[0] <= lo <= MEKONG_BBOX[2] and MEKONG_BBOX[1] <= la <= MEKONG_BBOX[3])


def main(argv=None):
    c.setup_logging()
    p = c.base_parser(__doc__)
    p.add_argument("--lhasa", type=Path, help="LHASA global GeoTIFF for rank correlation")
    p.add_argument("--n-background", type=int, default=2000)
    p.add_argument("--glc-csv", type=Path, help="local GLC CSV (else downloaded)")
    a = p.parse_args(argv)
    if a.dry_run:
        print(f"[dry-run] download {GLC_URL}; keep TH + accuracy {sorted(OK_ACCURACY)}; sample S vs {a.n_background} random "
              f"background points at 100 m; AUC; write {c.OUT_DIR / 'validation.md'}")
        return 0
    project = c.require_project(a.project, False)
    text = a.glc_csv.read_text(encoding="utf-8") if a.glc_csv else _download(GLC_URL)
    rows = list(csv.DictReader(io.StringIO(text)))
    events = filter_glc(rows, MEKONG_BBOX)
    c.log.info("%d GLC events kept", len(events))
    if len(events) < 5:
        raise SystemExit("too few landslide events to validate")
    ee = c.ee_init(project)
    from app.settings import assets
    from app.geo import ee_model
    sasset = assets().get("susceptibility_asset")
    s = ee.Image(sasset).select("S") if sasset else ee_model.susceptibility(ee_model.factors())
    th = c.thailand_geometry()
    ev_fc = ee.FeatureCollection([ee.Feature(ee.Geometry.Point(lo, la)) for lo, la in events])
    bg_fc = ee.FeatureCollection.randomPoints(th, a.n_background, 42)
    def sample(fc):
        out = s.sampleRegions(fc, scale=100, geometries=True, tileScale=4).getInfo()["features"]
        return [(f["properties"]["S"], f["geometry"]["coordinates"]) for f in out if f["properties"].get("S") is not None]
    pos, neg = sample(ev_fc), sample(bg_fc)
    a_roc = auc([v for v, _ in pos], [v for v, _ in neg])
    lines = ["# Susceptibility validation", "", f"Run: {c.today()}  ",
             f"S source: `{sasset or 'on-the-fly ee_model'}`  ",
             f"Events: {len(pos)} NASA GLC points (TH, accuracy <= 5 km; Mekong bbox if <30)  ",
             f"Background: {len(neg)} random points in Thailand bbox  ", "",
             f"- ROC-AUC (events vs background): **{a_roc:.3f}**",
             f"- Mean S events {sum(v for v, _ in pos) / len(pos):.3f} vs background {sum(v for v, _ in neg) / len(neg):.3f}"]
    if a.lhasa:
        import rasterio
        coords = [xy for _, xy in pos + neg]
        with rasterio.open(a.lhasa) as ds:
            lv = [float(v[0]) for v in ds.sample(coords)]
        rho = spearman([v for v, _ in pos + neg], lv)
        lines.append(f"- Spearman rho vs LHASA ({a.lhasa.name}) at {len(coords)} points: **{rho:.3f}**")
    lines += ["", "Caveats: GLC is media/report-based (biased to roads and populated areas, ends 2016); background points are not",
              "confirmed landslide-free; AUC is a screening sanity check, not a skill claim for the trigger model."]
    c.OUT_DIR.mkdir(parents=True, exist_ok=True)
    (c.OUT_DIR / "validation.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    return 0


def _download(url: str) -> str:
    import httpx
    r = httpx.get(url, follow_redirects=True, timeout=120)
    r.raise_for_status()
    return r.text


if __name__ == "__main__":
    raise SystemExit(main())
