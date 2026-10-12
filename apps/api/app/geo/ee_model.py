"""Earth Engine model core, shared by the request-time backend and the precompute scripts.

All dataset IDs come from config/datasets.yaml, all weights/thresholds from config/*.yaml.
Pixel math here must stay in sync with app/geo/hazard_math.py (the pure-python twin used in tests).
Factor bands are normalised 0..1; S = sum(w_i * f_i).
"""
import ee

from app.settings import load_yaml

SCALE_M = 100
FACTOR_BANDS = ["slope", "curvature", "landcover", "forest_loss", "soil_clay", "soil_sand",
                "stream_proximity", "elevation_relief"]


def _clamp01(img: ee.Image) -> ee.Image:
    return img.max(0).min(1)


def _norm(img: ee.Image, lo: float, hi: float) -> ee.Image:
    return _clamp01(img.subtract(lo).divide(hi - lo))


def factors() -> ee.Image:
    """Normalised (0..1) conditioning factors at ~100 m. Global-capable; callers clip/reduce to AOI."""
    ds, w = load_yaml("datasets.yaml"), load_yaml("weights.yaml")
    proj = ee.Projection("EPSG:4326").atScale(SCALE_M)

    dem = ee.Image(ds["dem"]).select("elevation")
    slope = ee.Terrain.slope(dem)
    # Laplacian curvature approximation (1/m); sign: positive = convex. Normalised by config range.
    curv = dem.convolve(ee.Kernel.laplacian8(normalize=False)).divide(30 * 30)
    relief = dem.focalMax(500, "circle", "meters").subtract(dem.focalMin(500, "circle", "meters"))

    lc = ee.ImageCollection(ds["landcover"]).first().select("Map")
    scores = w["landcover_score"]
    landcover = lc.remap(list(map(int, scores)), list(scores.values()), 0.5)

    h = ee.Image(ds["forest"])
    last_loss_year = 25  # 2025 in v1.13; lossyear is years since 2000
    # Hansen bands are masked outside forest/land; "no recent loss" must be 0, not nodata, or S loses those pixels.
    recent_loss = h.select("lossyear").gt(last_loss_year - 10).And(h.select("treecover2000").gt(30)).unmask(0)

    clay = ee.Image(ds["soil_clay"]).select("b0")
    sand = ee.Image(ds["soil_sand"]).select("b0")

    upa = ee.Image(ds["hydro"]).select("upa")           # upstream drainage area, km2
    channels = upa.gt(w["normalisation"].get("channel_upa_km2", 5))
    dist_m = channels.fastDistanceTransform(256).sqrt().multiply(ee.Image.pixelArea().sqrt())
    sd = w["normalisation"]["stream_dist_m"]
    proximity = ee.Image(1).subtract(_norm(dist_m, sd["near"], sd["far"]))

    n = w["normalisation"]
    img = ee.Image.cat([
        _norm(slope, n["slope_deg"]["min"], n["slope_deg"]["max"]).rename("slope"),
        _norm(curv, n["curvature"]["min"], n["curvature"]["max"]).rename("curvature"),
        landcover.rename("landcover"),
        recent_loss.rename("forest_loss"),
        _norm(clay, 0, 60).rename("soil_clay"),
        _norm(sand, 0, 80).rename("soil_sand"),
        proximity.rename("stream_proximity"),
        _norm(relief, 0, 600).rename("elevation_relief"),
    ])
    return img.float().setDefaultProjection(proj)


def susceptibility(f: ee.Image) -> ee.Image:
    """Weighted overlay S in 0..1 from a factors() image (or the precomputed asset's factor bands)."""
    weights = load_yaml("weights.yaml")["weights"]
    s = ee.Image(0)
    for band in FACTOR_BANDS:
        s = s.add(f.select(band).multiply(weights[band]))
    return s.rename("S")


def hazard(s: ee.Image, trigger_ratio: float, wetness: "ee.Image | float" = 0.0) -> ee.Image:
    """Continuous hazard H = S * (1 - exp(-k * TR * (1 + a * W))). TR is a python float (spatially uniform)."""
    c = load_yaml("thresholds.yaml")["hazard"]
    w = ee.Image(wetness)
    exponent = w.multiply(c["antecedent_gain"]).add(1).multiply(-c["k"] * trigger_ratio)
    return s.multiply(ee.Image(1).subtract(exponent.exp())).rename("H")


def classify(h: ee.Image) -> ee.Image:
    """Integer classes 1..4 (Low, Moderate, High, Very High) using config cutoffs."""
    cuts = load_yaml("thresholds.yaml")["hazard"]["class_cutoffs"]
    cls = ee.Image(1)
    for c in cuts:
        cls = cls.add(h.gte(c))
    return cls.rename("class").toInt()


def class_vis() -> dict:
    t = load_yaml("thresholds.yaml")["hazard"]
    return {"min": 1, "max": 4, "palette": [c.lstrip("#") for c in t["class_colors"]]}
