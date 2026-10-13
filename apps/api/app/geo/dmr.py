"""DMR / ADPC landslide-risk method on Earth Engine.

Risk = Trigger x Susceptibility x Vulnerability x Exposure / 125   (each factor a 1..5 class; trigger 0..5) -> 0..5
 - Trigger: tambon 30-day rainfall vs the tambon's own percentile thresholds (P60/70/80/90/95 -> classes 1..5, below P60 -> 0).
 - Susceptibility: ADPC CNN map (0..100); pixels >= threshold only, classed by the z-score ("Standardize") method.
 - Vulnerability / Exposure: continuous 0..1 indices scaled to classes 1..5.
Config lives in config/dmr.yaml. Pure helpers (no EE) are unit-tested; EE builders return lazy images.
Known deviation from the reference script: a tambon with a missing threshold gets trigger class 0 (the script's safeNum would
turn a null threshold into 0 and give class 5).
"""
import math
from concurrent.futures import ThreadPoolExecutor

import ee

from app.geo.ee_init import get_info, init, retry
from app.settings import load_yaml

RAIN_SCALE_M = 11132   # reduce rainfall at the IMERG/GSMaP native grid
STATS_SCALE_M = 100    # tambon statistics (WorldPop is 100 m)
TOP_TAMBON = 10


def cfg() -> dict:
    return load_yaml("dmr.yaml")


# ---------------- pure helpers (unit-tested) ----------------
def zscore_breaks(mean: float, sd: float, ks: list[float]) -> list[float]:
    return [mean + k * sd for k in ks]


def class_from_breaks(value: float, breaks: list[float]) -> int:
    """1 + number of breaks strictly below the value (matches the script's `.gt(b)` chain)."""
    return 1 + sum(value > b for b in breaks)


def scaled_class(x: float, multiplier: float) -> int:
    """ceil(x * multiplier) clamped to 1..5."""
    return int(min(5, max(1, math.ceil(x * multiplier))))


def trigger_class(rain_mm: float | None, thresholds: list[float | None]) -> int:
    """Highest threshold exceeded: thresholds ascending [P60, P70, P80, P90, P95] -> 1..5; none exceeded or rain missing -> 0."""
    if rain_mm is None:
        return 0
    best = 0
    for i, thr in enumerate(thresholds):
        if thr is not None and rain_mm >= thr:
            best = i + 1
    return best


def risk_value(trigger: int, susc: int, vuln: int, expo: int, divisor: float = 125.0) -> float:
    return trigger * susc * vuln * expo / divisor


def risk_class(value: float, cutoffs: list[float]) -> int:
    return 1 + sum(value >= c for c in cutoffs)


def risk_legend() -> list[dict]:
    r = cfg()["risk"]
    return [{"label": n, "color": c} for n, c in zip(r["class_names"], r["class_colors"])]


# ---------------- Earth Engine images ----------------
def _a(key: str) -> str:
    return cfg()["assets"][key]


def susceptibility() -> ee.Image:
    return ee.Image(_a("susceptibility")).select(0).rename("s")


def susceptibility_mask() -> ee.Image:
    s = susceptibility()
    return s.gte(cfg()["susceptibility_threshold"])


def susceptibility_class() -> ee.Image:
    """1..5 on the z-score breaks, masked below the susceptibility threshold."""
    z = cfg()["susceptibility_zscore"]
    b = zscore_breaks(z["mean"], z["stddev"], z["k"])
    s = susceptibility()
    c = ee.Image(1)
    for i, bi in enumerate(b):
        c = c.where(s.gt(bi), i + 2)
    return c.updateMask(susceptibility_mask()).toByte().rename("susc_class")


def vulnerability_index() -> ee.Image:
    return ee.Image(_a("vulnerability")).select(0).rename("vuln")


def exposure_index() -> ee.Image:
    return ee.Image(_a("exposure")).select(0).rename("expo")


def _class_1_5(img: ee.Image, mult: float, name: str) -> ee.Image:
    return img.multiply(mult).ceil().max(1).min(5).toInt8().rename(name)


def vulnerability_class() -> ee.Image:
    return _class_1_5(vulnerability_index(), cfg()["scaling"]["vulnerability_multiplier"], "vuln_class")


def exposure_class() -> ee.Image:
    return _class_1_5(exposure_index(), cfg()["scaling"]["exposure_multiplier"], "expo_class")


# ---------------- tambon thresholds and trigger ----------------
def tambons(region: ee.Geometry, area=None) -> ee.FeatureCollection:
    """Tambon polygons (with thresholds) inside the AOI; narrowed to the named province/amphoe/tambon when known."""
    fc = ee.FeatureCollection(_a("thresholds")).filterBounds(region)
    level, pcode = getattr(area, "level", None), getattr(area, "pcode", None) or getattr(area, "admin_code", None)
    key = {"province": "adm1_pcode", "amphoe": "adm2_pcode", "tambon": "adm3_pcode"}.get(level or "")
    if key and pcode:
        fc = fc.filter(ee.Filter.eq(key, pcode))
    return fc


TAMBON_KEEP = ["adm3_pcode", "adm3_name", "adm3_name1", "adm2_pcode", "adm2_name", "adm2_name1", "adm1_pcode", "adm1_name",
               "adm1_name1", "area_sqkm", "center_lat", "center_lon"]


def tambon_mean_rows(fc: ee.FeatureCollection, img: ee.Image) -> list[dict]:
    """One round trip: per-tambon mean of a rainfall image (mm) together with the tambon's names and thresholds.
    Mean is linear, so mean(observed + X) = mean(observed) + X and mean(observed + forecast) = mean(observed) + mean(forecast):
    callers cache these rows and add scenario rainfall in Python (see classify_rows), so slider changes cost no EE time."""
    cols = cfg()["trigger"]["columns"]
    red = img.rename("rain").reduceRegions(
        collection=fc, reducer=ee.Reducer.mean().setOutputs(["mean"]), scale=RAIN_SCALE_M, tileScale=4)
    rows = get_info(red.select(TAMBON_KEEP + cols + ["mean"], retainGeometry=False).toList(10000))
    return [{**{k: f["properties"].get(k) for k in TAMBON_KEEP},
             "thresholds": [f["properties"].get(c) for c in cols], "mean": f["properties"].get("mean")} for f in rows]


def classify_rows(rows: list[dict], add_mm: float = 0.0, add_by_code: dict[str, float] | None = None) -> list[dict]:
    """rain30_mm = tambon mean + scenario rainfall; trigger_class from the tambon thresholds."""
    out = []
    for r in rows:
        base = r["mean"]
        rain = None if base is None else base + add_mm + (add_by_code or {}).get(r["adm3_pcode"], 0.0)
        out.append({**r, "rain30_mm": rain, "trigger_class": trigger_class(rain, r["thresholds"])})
    return out


def with_trigger(fc: ee.FeatureCollection, rows: list[dict]) -> ee.FeatureCollection:
    """Tambon FC with trigger_class set from a literal lookup (no rainfall recomputation downstream)."""
    lookup = ee.Dictionary({r["adm3_pcode"]: r["trigger_class"] for r in rows})
    return fc.map(lambda f: f.set("trigger_class", ee.Number(lookup.get(f.get("adm3_pcode"), 0))))


def trigger_raster(trig_fc: ee.FeatureCollection) -> ee.Image:
    return ee.Image().byte().paint(trig_fc, "trigger_class").rename("trigger_class")


def static_product() -> ee.Image:
    """Rain-independent part of the risk: susceptibility x vulnerability x exposure classes (1..125), 12 m, on the fly."""
    return susceptibility_class().multiply(vulnerability_class()).multiply(exposure_class()).rename("prod")


def static_stats_bands() -> ee.Image:
    """Bands for tambon statistics: prod, expo_class, expo. Uses the precomputed 100 m asset when built (assets.local.yaml
    -> dmr_static_asset, see scripts/build_dmr_static.py), otherwise computes from the 12 m sources."""
    from app.settings import assets
    asset = assets().get("dmr_static_asset")
    if asset:
        return ee.Image(asset)
    return ee.Image.cat([static_product(), exposure_class().rename("expo_class"), exposure_index().rename("expo")])


def risk_from(trig: ee.Image, prod: ee.Image) -> ee.Image:
    """Continuous risk 0..5 = trigger x prod / 125, masked where trigger = 0 or the product is masked."""
    return trig.multiply(prod).divide(cfg()["risk"]["divisor"]).updateMask(trig.gt(0)).rename("risk")


def risk_image(trig: ee.Image) -> ee.Image:
    """Risk at full 12 m resolution (map tiles)."""
    return risk_from(trig, static_product())


def risk_class_image(risk: ee.Image) -> ee.Image:
    """Integer risk class 1..5 from the cutoffs (masked like risk)."""
    c = ee.Image(1)
    for cut in cfg()["risk"]["cutoffs"]:
        c = c.add(risk.gte(cut))
    return c.updateMask(risk.mask()).toByte().rename("risk_class")


# ---------------- map layers ----------------
def _vis(key: str) -> dict:
    v = cfg()["layers"][key]
    return {"min": v["min"], "max": v["max"], "palette": v["palette"]}


def _tile(img: ee.Image, vis: dict) -> str:
    def go():
        m = img.getMapId(vis)
        tf = m.get("tile_fetcher") if isinstance(m, dict) else None
        return tf.url_format if tf is not None else m["urlFormat"]
    return retry(go)


def _legend(k: str) -> list[dict]:
    c = cfg()["layers"][k]
    if k == "risk":
        return risk_legend()
    if k == "rain":
        return [{"label": f"{c['min']}", "color": "#" + c["palette"][0]}, {"label": f"{c['max']}+ mm", "color": "#" + c["palette"][-1]}]
    if k == "trigger":
        return [{"label": str(i), "color": "#" + col} for i, col in enumerate(c["palette"], start=c["min"])]
    if k == "population":
        return population_legend()
    names = cfg()["risk"]["class_names"]
    return [{"label": names[i - 1], "color": "#" + col} for i, col in enumerate(c["palette"], start=1)]


def _layer(k: str, img: ee.Image, url: str, sid: str, visible: bool, group: str) -> dict:
    c = cfg()["layers"][k]
    return {"id": f"{sid}-{k}", "key": k, "name": c["name"], "tile_url": url, "opacity": 0.75, "visible": visible,
            "legend": _legend(k), "group": group}


def build_layers(region: ee.Geometry, rain_mm: ee.Image, trig: ee.Image, risk: ee.Image, scenario_id: str) -> list[dict]:
    """Scenario (dynamic) layers only: risk (visible), trigger, rain. Static reference layers are served by static_layers()."""
    imgs = {"risk": risk.clip(region), "trigger": trig.selfMask().clip(region), "rain": rain_mm.clip(region)}
    with ThreadPoolExecutor(max_workers=len(imgs)) as ex:
        urls = dict(zip(imgs, ex.map(lambda k: _tile(imgs[k], _vis(k)), imgs)))
    return [_layer(k, imgs[k], urls[k], scenario_id, k == "risk", "scenario") for k in imgs]


_STATIC_TTL_S = 7000          # EE map ids last "a few hours"
_static_cache: dict = {"t": 0.0, "layers": None}


def static_layers() -> dict:
    """National reference layers (susceptibility, vulnerability, exposure, population), all off by default. Cached ~2 h."""
    import time
    now = time.time()
    if _static_cache["layers"] and now - _static_cache["t"] < _STATIC_TTL_S:
        return {"layers": _static_cache["layers"], "expires_in_s": int(_STATIC_TTL_S - (now - _static_cache["t"]))}
    init()
    imgs = {"susceptibility": susceptibility_class(), "vulnerability": vulnerability_class(), "exposure": exposure_class(),
            "population": population_layer()}
    with ThreadPoolExecutor(max_workers=len(imgs)) as ex:
        urls = dict(zip(imgs, ex.map(lambda k: _tile(imgs[k], _vis(k)), imgs)))
    layers = [_layer(k, imgs[k], urls[k], "static", False, "static") for k in imgs]
    _static_cache.update(t=now, layers=layers)
    return {"layers": layers, "expires_in_s": _STATIC_TTL_S}


# ---------------- statistics ----------------
def area_by_risk_class(risk_cls: ee.Image, region: ee.Geometry, scale: int = 250) -> dict[str, float]:
    names = cfg()["risk"]["class_names"]
    red = ee.Reducer.sum().group(groupField=1, groupName="class")
    d = get_info(ee.Image.pixelArea().addBands(risk_cls).reduceRegion(
        red, region, scale, bestEffort=True, maxPixels=int(1e9), tileScale=4))
    out = {n: 0.0 for n in names}
    for g in d.get("groups", []):
        i = int(g["class"]) - 1
        if 0 <= i < len(names):
            out[names[i]] = round(g["sum"] / 1e6, 1)
    return out


def tambon_stats(trig_fc: ee.FeatureCollection, trig: ee.Image, pop: ee.Image, region: ee.Geometry, high_from: int | None = None) -> dict:
    """Per-tambon risk and exposure rows + AOI area by risk class, in ONE round trip.
    Uses the static stats bands (100 m asset when built) so the heavy 12 m math is not repeated per request."""
    r = cfg()["risk"]
    high_value = r["cutoffs"][(high_from or r["exposure_from"]) - 2]   # class >= high_from  <=>  risk value >= high_value
    s = static_stats_bands()
    risk = risk_from(trig, s.select("prod"))
    stack = (risk.rename("risk")
             .addBands(risk.gte(high_value).unmask(0).rename("share_high"))
             .addBands(s.select("expo").rename("expo"))
             .addBands(s.select("expo_class").rename("expo_class")))
    means = stack.reduceRegions(collection=trig_fc, reducer=ee.Reducer.mean(), scale=STATS_SCALE_M, tileScale=4)
    maxes = risk.rename("risk_max").reduceRegions(
        collection=trig_fc, reducer=ee.Reducer.max().setOutputs(["risk_max"]), scale=STATS_SCALE_M, tileScale=4)
    people = pop.updateMask(risk.gte(high_value)).rename("people_high").reduceRegions(
        collection=trig_fc, reducer=ee.Reducer.sum().setOutputs(["people_high"]), scale=STATS_SCALE_M, tileScale=4)
    groups = ee.Image.pixelArea().addBands(risk_class_image(risk)).reduceRegion(
        ee.Reducer.sum().group(groupField=1, groupName="class"), region, 250, bestEffort=True, maxPixels=int(1e9), tileScale=4)
    keep = ["adm3_pcode", "rain30_mm", "trigger_class", "risk", "share_high", "expo", "expo_class", "risk_max", "people_high"]
    res = get_info(ee.Dictionary({"m": means.toList(10000), "x": maxes.toList(10000), "p": people.toList(10000), "g": groups}))
    rows: dict[str, dict] = {}
    for key in ("m", "x", "p"):
        for f in res[key]:
            pr = f["properties"]
            rows.setdefault(pr.get("adm3_pcode"), {}).update({k: pr[k] for k in keep if k in pr})
    names = r["class_names"]
    areas = {n: 0.0 for n in names}
    for g in res["g"].get("groups", []):
        i = int(g["class"]) - 1
        if 0 <= i < len(names):
            areas[names[i]] = round(g["sum"] / 1e6, 1)
    return {"rows": rows, "class_area_km2": areas}


def thailand_mask() -> ee.Image:
    """1 inside Thailand's border (provincial boundaries), masked elsewhere. Painted lazily, cheap at tile time."""
    fc = ee.FeatureCollection(cfg()["assets"]["thailand_adm1"]).filter(ee.Filter.eq("shapeGroup", "THA"))
    return ee.Image().byte().paint(fc, 1).selfMask()


def _fmt(x: float) -> str:
    return f"{x:g}"


def population_legend() -> list[dict]:
    """Value-range legend that matches population_layer()'s classes exactly (people per hectare)."""
    c = cfg()["layers"]["population"]
    b, pal = c["breaks"], c["palette"]
    labels = [f"{_fmt(b[i])}\u2013{_fmt(b[i + 1])}" for i in range(len(b) - 1)] + [f"{_fmt(b[-1])}+"]
    return [{"label": f"{lab} people/ha", "color": "#" + col} for lab, col in zip(labels, pal)]


def population_layer() -> ee.Image:
    """WorldPop 2020 as discrete density classes 1..N (people per hectare), only inside Thailand; below the first break is masked."""
    pop = worldpop().updateMask(thailand_mask())
    cls = ee.Image(0)
    for b in cfg()["layers"]["population"]["breaks"]:
        cls = cls.add(pop.gte(b))
    return cls.selfMask().toByte().rename("pop_class")


def worldpop() -> ee.Image:
    """WorldPop 100 m population (2020 mosaic)."""
    from app.settings import assets
    return (ee.ImageCollection(assets()["population"]).filter(ee.Filter.eq("year", 2020))
            .mosaic().select("population"))
