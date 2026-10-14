"""Real Earth Engine backend. Same function names/return shapes as mock.py (plus extra keys).

Pure shaping/rounding helpers take plain dicts so they are testable without EE.
Assumed asset schemas (defined by scripts/): susceptibility asset bands = S + ee_model.FACTOR_BANDS;
exposure stack bands = pop, bldg_count, bldg_area, road_m_{primary,secondary,tertiary,local,track},
school_n, health_n, shelter_n, bridge_n; tambon FC props ADM3_PCODE/ADM3_EN/ADM3_TH (HDX cod-ab-tha);
facilities FC props `kind` (school|hospital|shelter|bridge) and `name`, point geometry.
"""
import logging

import ee

from app.geo import ee_model, rain
from app.geo.ee_init import get_info, init, retry
from app.geo.hazard_math import trigger_ratio
from app.settings import assets, load_yaml

log = logging.getLogger(__name__)

ROAD_CLASSES = ["primary", "secondary", "tertiary", "local", "track"]
STACK_SUM_BANDS = (["pop", "bldg_count", "bldg_area"] + [f"road_m_{c}" for c in ROAD_CLASSES]
                   + ["school_n", "health_n", "shelter_n", "bridge_n"])
AREA_SCALE_M = 250
EXPOSURE_SCALE_M = 100
FACILITY_CAP = 200
TOP_UNITS = 10
WORLDPOP_YEAR = 2020


# ---------------- pure helpers ----------------
def round_people(x: float) -> int:
    step = 1000 if x > 100_000 else 100
    return int(round(x / step) * step)


def round_buildings(x: float) -> int:
    return int(round(x / 10) * 10)


def class_names() -> list[str]:
    return load_yaml("thresholds.yaml")["hazard"]["class_names"]


def class_index(min_class: str) -> int:
    names = class_names()
    if min_class not in names:
        raise ValueError(f"min_class must be one of {names}")
    return names.index(min_class) + 1


def legend() -> list[dict]:
    h = load_yaml("thresholds.yaml")["hazard"]
    return [{"label": n, "color": c} for n, c in zip(h["class_names"], h["class_colors"])]


def groups_to_class_km2(groups: list[dict]) -> dict[str, float]:
    """Grouped reducer output [{'class':1,'sum':m2},...] -> {name: km2}; all four classes always present."""
    names = class_names()
    out = {n: 0.0 for n in names}
    for g in groups or []:
        i = int(g["class"]) - 1
        if 0 <= i < len(names):
            out[names[i]] += float(g["sum"]) / 1e6
    return {k: round(v, 1) for k, v in out.items()}


def _num(props: dict, key: str) -> float:
    v = props.get(key)
    return float(v) if v is not None else 0.0


def _pick(props: dict, keys: list[str]):
    for k in keys:
        if props.get(k) not in (None, ""):
            return props[k]
    return None


def shape_exposure(unit_props: list[dict], min_class: str, household_size: float) -> dict:
    """Aggregate per-tambon sum-reducer properties into the exposure payload core (no provenance keys)."""
    tot = {b: sum(_num(p, b) for p in unit_props) for b in STACK_SUM_BANDS}
    road_by_class = {c: round(tot[f"road_m_{c}"] / 1000, 1) for c in ROAD_CLASSES}
    people_raw = tot["pop"]
    units = []
    for p in sorted(unit_props, key=lambda p: -_num(p, "pop"))[:TOP_UNITS]:
        if _num(p, "pop") <= 0:
            continue
        units.append({
            "name": _pick(p, ["ADM3_EN", "name_en", "name"]),
            "name_th": _pick(p, ["ADM3_TH", "name_th"]),
            "admin_code": _pick(p, ["ADM3_PCODE", "admin_code"]),
            "people": round_people(_num(p, "pop")),
            "buildings": round_buildings(_num(p, "bldg_count")),
            "road_km": round(sum(_num(p, f"road_m_{c}") for c in ROAD_CLASSES) / 1000, 1),
        })
    return {
        "people": round_people(people_raw),
        "households_est": round_people(people_raw / household_size),
        "household_size_assumed": household_size,
        "buildings": round_buildings(tot["bldg_count"]),
        "building_area_m2": round(tot["bldg_area"]),
        "road_km": round(sum(road_by_class.values()), 1),
        "road_km_by_class": road_by_class,
        "schools": int(round(tot["school_n"])),
        "hospitals": int(round(tot["health_n"])),
        "shelters": int(round(tot["shelter_n"])),
        "bridges": int(round(tot["bridge_n"])),
        "top_admin_units": units,
        "min_class": min_class,
    }


def shape_facilities(features: list[dict], cap: int = FACILITY_CAP) -> list[dict]:
    out = []
    for f in features:
        g = f.get("geometry") or {}
        if g.get("type") != "Point":
            continue
        p = f.get("properties") or {}
        lng, lat = g["coordinates"][:2]
        out.append({"lat": round(lat, 5), "lng": round(lng, 5), "name": p.get("name") or "", "kind": p.get("kind") or ""})
        if len(out) >= cap:
            break
    return out


def shape_explain(props: dict, weights: dict) -> dict:
    factors = []
    for b in ee_model.FACTOR_BANDS:
        v = props.get(b)
        v = 0.0 if v is None else float(v)
        factors.append({"name": b, "value": round(v, 3), "contribution": round(weights[b] * v, 3)})
    factors.sort(key=lambda f: -f["contribution"])
    s = round(sum(f["contribution"] for f in factors), 3)
    top = ", ".join(f"{f['name']} ({f['contribution']:.2f})" for f in factors[:3])
    return {"factors": factors, "S": s, "summary": f"Susceptibility S={s:.2f} (0-1). Largest contributors: {top}."}


def base_limitations(extra: list[str] | None = None) -> list[str]:
    osm = assets().get("osm_extract_date") or "the date of the Geofabrik extract used when the exposure stack was built"
    out = [
        "Screening-level model (weighted susceptibility overlay x intensity-duration trigger); not a forecast.",
        "Rainfall is assumed spatially uniform over the area for the scenario; antecedent wetness comes from IMERG.",
        "Households are an estimate: people / assumed household size.",
        "Population is WorldPop 2020 (constrained to the 2020 baseline); people rounded to nearest 100 (1,000 above 100k).",
        "Building counts depend on Open Buildings / GHSL coverage and may under-count in some rural areas.",
        f"Roads and facilities come from OpenStreetMap as of {osm}; completeness varies.",
    ]
    return out + (extra or [])


def _sources(stack: bool) -> list[str]:
    a = assets()
    s = [a["dem"], a["landcover"], a["forest"], a["soil_clay"], a["soil_sand"], a["hydro"], a["imerg"]]
    s.append(a["population"] if not stack else "exposure_stack (WorldPop 2020, buildings, OSM)")
    return s


# ---------------- Earth Engine pieces ----------------
def _aoi(area) -> ee.Geometry:
    geom = getattr(area, "geometry", None)
    if geom:
        return ee.Geometry(geom)
    w, s, e, n = area.bbox
    return ee.Geometry.Rectangle([w, s, e, n], proj="EPSG:4326", geodesic=False)


def _susceptibility(region: ee.Geometry) -> tuple[ee.Image, bool]:
    """(S image clipped to AOI, from_asset)."""
    asset = assets().get("susceptibility_asset")
    if asset:
        return ee.Image(asset).select("S").clip(region), True
    log.warning("susceptibility_asset not set: computing S on the fly for the AOI (slower)")
    f = ee_model.factors().clip(region)
    return ee_model.susceptibility(f), False


def _hazard_images(area, tr: float, wetness_img) -> tuple[ee.Image, ee.Image, ee.Geometry, bool]:
    region = _aoi(area)
    s, from_asset = _susceptibility(region)
    h = ee_model.hazard(s, tr, wetness_img)
    return h, ee_model.classify(h).clip(region), region, from_asset


def _tile_url(cls: ee.Image) -> str:
    def go():
        m = cls.selfMask().getMapId(ee_model.class_vis())
        tf = m.get("tile_fetcher") if isinstance(m, dict) else None
        return tf.url_format if tf is not None else m["urlFormat"]
    return retry(go)


def _class_areas(cls: ee.Image, region: ee.Geometry) -> dict:
    red = ee.Reducer.sum().group(groupField=1, groupName="class")
    d = get_info(ee.Image.pixelArea().addBands(cls).reduceRegion(
        red, region, AREA_SCALE_M, bestEffort=True, maxPixels=int(1e9), tileScale=4))
    return groups_to_class_km2(d.get("groups", []))


def _prepare(area, rainfall_mm: float, duration_h: float):
    init()
    tr = trigger_ratio(rainfall_mm, duration_h)
    total, meta = rain.antecedent_total_image()
    w_img = rain.wetness_image(total)
    return tr, total, meta, w_img


def _scenario_payload(area, tr, total, meta, w_img) -> dict:
    h, cls, region, from_asset = _hazard_images(area, tr, w_img)
    ante_mm = rain.region_mean(total, region)
    extra = []
    if not from_asset:
        extra.append("Susceptibility computed on the fly at ~250 m (precomputed asset not built yet).")
    return {
        "trigger_ratio": round(tr, 2),
        "class_area_km2": _class_areas(cls, region),
        "tile_url": _tile_url(cls),
        "legend": legend(),
        "resolution_m": 100 if from_asset else AREA_SCALE_M,
        "date_of_data": meta["date_of_data"],
        "data_sources": _sources(from_asset and bool(assets().get("exposure_stack_asset"))),
        "limitations": base_limitations(extra + _staleness(meta)),
        "antecedent_mm": round(ante_mm, 1),
        "antecedent_days": meta["days"],
    }


def _staleness(meta: dict) -> list[str]:
    import time
    age_d = (time.time() * 1000 - meta["newest_ms"]) / rain.DAY_MS
    if age_d > 7:
        return [f"Newest IMERG rainfall image is {age_d:.0f} days old ({meta['date_of_data']}); antecedent wetness may lag."]
    return []


# ---------------- public API ----------------
def hazard_scenario(area, rainfall_mm: float, duration_h: float) -> dict:
    tr, total, meta, w_img = _prepare(area, rainfall_mm, duration_h)
    return _scenario_payload(area, tr, total, meta, w_img)


def forecast_hazard(area, horizon_days: int = 5) -> dict:
    init()
    region = _aoi(area)
    gfs = rain.gfs_forecast(region, horizon_days)
    total, meta = rain.antecedent_total_image()
    w_img = rain.wetness_image(total)
    duration_h = max(1.0, float(gfs["horizon_h"]))
    tr = trigger_ratio(gfs["forecast_mm"], duration_h) if gfs["forecast_mm"] > 0 else 0.0
    out = _scenario_payload(area, tr, total, meta, w_img)
    out["data_sources"] = out["data_sources"] + [gfs["dataset"]]
    out["limitations"] = out["limitations"] + [
        "Forecast hazard uses the AOI-mean GFS accumulated rainfall (0.25 deg) as uniform rain over the horizon; "
        "GFS can miss localised convective extremes."
    ] + ([f"GFS run covers only {gfs['covered_hours']} h of the requested {gfs['horizon_h']} h."]
         if gfs["covered_hours"] < gfs["horizon_h"] else [])
    out.update(forecast_rain_mm=round(gfs["forecast_mm"], 1), observed_rain_mm=out["antecedent_mm"],
               horizon_days=horizon_days, model_run_time=gfs["model_run_time"])
    return out


def _facilities(cls: ee.Image, region: ee.Geometry, min_idx: int) -> ee.FeatureCollection | None:
    fac = assets().get("facilities_asset")
    if not fac:
        return None
    fc = ee.FeatureCollection(fac).filterBounds(region).limit(5000)
    fc = cls.reduceRegions(fc, ee.Reducer.first().setOutputs(["hz"]), EXPOSURE_SCALE_M, tileScale=4)
    return fc.filter(ee.Filter.gte("hz", min_idx)).limit(FACILITY_CAP)


def _tambon_in(area, region: ee.Geometry) -> ee.FeatureCollection:
    fc = ee.FeatureCollection(assets()["tambon_asset"]).filterBounds(region)
    code = getattr(area, "admin_code", "") or ""
    if code.startswith("TH"):
        fc = fc.filter(ee.Filter.stringStartsWith("ADM3_PCODE", code))
    return fc


def exposure(area, rainfall_mm: float, duration_h: float, min_class: str = "High", forecast_days: int | None = None) -> dict:
    min_idx = class_index(min_class)
    tr, total, meta, w_img = _prepare(area, rainfall_mm, duration_h)
    h, cls, region, from_asset = _hazard_images(area, tr, w_img)
    hs = load_yaml("thresholds.yaml")["exposure"]["household_size"]
    a = assets()
    mask = cls.gte(min_idx)
    prov = {"date_of_data": meta["date_of_data"], "min_class": min_class}

    if a.get("exposure_stack_asset") and a.get("tambon_asset"):
        stack = ee.Image(a["exposure_stack_asset"]).select(STACK_SUM_BANDS).updateMask(mask)
        units = stack.reduceRegions(_tambon_in(area, region), ee.Reducer.sum(), EXPOSURE_SCALE_M, tileScale=4)
        units = units.map(lambda f: f.setGeometry(None))
        bundle = {"units": units}
        fac = _facilities(cls, region, min_idx)
        if fac is not None:
            bundle["fac"] = fac
        res = get_info(ee.Dictionary(bundle))
        payload = shape_exposure([f["properties"] for f in res["units"]["features"]], min_class, hs)
        payload["facilities"] = shape_facilities(res["fac"]["features"]) if "fac" in res else []
        lim = base_limitations(_staleness(meta) + ([] if fac is not None else
                               ["Facility point layer not built yet: no facility markers."]))
        return {**payload, **prov, "resolution_m": EXPOSURE_SCALE_M, "data_sources": _sources(True), "limitations": lim}

    # Fallback: population only (WorldPop), everything else unknown, never fabricated.
    pop = (ee.ImageCollection(a["population"]).filter(ee.Filter.eq("year", WORLDPOP_YEAR))
           .filterBounds(region).select("population").mosaic())
    d = get_info(pop.updateMask(mask).reduceRegion(
        ee.Reducer.sum(), region, EXPOSURE_SCALE_M, bestEffort=True, maxPixels=int(1e9), tileScale=4))
    people = float(d.get("population") or 0)
    lim = base_limitations(_staleness(meta)) + [
        "Exposure layers (buildings, roads, facilities, tambon ranking) are not built yet: only population is reported; "
        "other fields are null."]
    return {
        "people": round_people(people), "households_est": round_people(people / hs), "household_size_assumed": hs,
        "buildings": None, "building_area_m2": None, "road_km": None, "road_km_by_class": None,
        "schools": None, "hospitals": None, "shelters": None, "bridges": None,
        "top_admin_units": [], "facilities": [], **prov,
        "resolution_m": EXPOSURE_SCALE_M, "data_sources": [a["population"]] + _sources(False)[:-1], "limitations": lim,
    }


def explain(lat: float, lng: float) -> dict:
    init()
    pt = ee.Geometry.Point([lng, lat])
    asset = assets().get("susceptibility_asset")
    lim = ["Normalised factor values (0-1) and weighted contributions to the static susceptibility S; "
           "screening-level, not a site assessment."]
    if asset:
        img = ee.Image(asset)
    else:
        img = ee_model.factors().clip(pt.buffer(1000))
        lim.append("Computed on the fly (susceptibility asset not built yet).")
    props = get_info(img.select(ee_model.FACTOR_BANDS).reduceRegion(ee.Reducer.first(), pt, ee_model.SCALE_M))
    if not props or all(v is None for v in props.values()):
        raise ValueError("No data at this location (outside coverage?)")
    out = shape_explain(props, load_yaml("weights.yaml")["weights"])
    out["limitations"] = lim
    return out
