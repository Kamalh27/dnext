"""Build the 100 m exposure stack over Thailand -> <folder>/exposure_stack.

Bands (exact): pop, bldg_count, bldg_area, road_m_primary, road_m_secondary, road_m_tertiary, road_m_local,
road_m_track, school_n, health_n, shelter_n, bridge_n.
Needs fetch_osm.py first (roads_<class> + facilities assets). Run order: see scripts/README.md.
"""
import _common as c

BANDS = ["pop", "bldg_count", "bldg_area", "road_m_primary", "road_m_secondary", "road_m_tertiary",
         "road_m_local", "road_m_track", "school_n", "health_n", "shelter_n", "bridge_n"]
ROAD_CLASSES = ["primary", "secondary", "tertiary", "local", "track"]
KIND_BAND = {"school": "school_n", "hospital": "health_n", "shelter": "shelter_n", "bridge": "bridge_n"}
COVERAGE_TEST_BBOX = c.REGION_BBOXES["nan"]


def ghsl_fallback(built_surface_m2: float, footprint_m2: float = 60.0) -> tuple[float, float]:
    """(bldg_count, bldg_area) from GHSL built surface: area = built surface, count = area / avg footprint."""
    return built_surface_m2 / footprint_m2, built_surface_m2


def choose_building_source(test_count: int) -> str:
    return "open_buildings_v3" if test_count > 0 else "ghsl_built_s_2020"


def footprint_m2() -> float:
    from app.settings import load_yaml
    return float(load_yaml("thresholds.yaml").get("exposure", {}).get("avg_footprint_m2", 60))


def main(argv=None):
    c.setup_logging()
    p = c.base_parser(__doc__)
    p.add_argument("--region", choices=sorted(c.REGION_BBOXES), default="bbox")
    p.add_argument("--force-ghsl", action="store_true", help="skip Open Buildings coverage check, use GHSL fallback")
    p.add_argument("--no-wait", action="store_true")
    a = p.parse_args(argv)
    project = c.require_project(a.project, a.dry_run)
    folder = c.asset_folder(project)
    test = a.region != "bbox"
    asset_id = f"{folder}/exposure_stack" + (f"_test_{a.region}" if test else "")
    bbox = c.region_bbox(a.region)
    if a.dry_run:
        print(f"[dry-run] export {len(BANDS)} bands {BANDS}\n  over {bbox} at 100 m to {asset_id}\n"
              f"  Open Buildings coverage check over {COVERAGE_TEST_BBOX}; GHSL fallback footprint={footprint_m2()} m2 if empty\n"
              f"  inputs: {folder}/roads_<{'|'.join(ROAD_CLASSES)}>, {folder}/facilities")
        return 0
    ee = c.ee_init(a.project)
    from app.settings import load_yaml
    ds = load_yaml("datasets.yaml")
    c.ensure_folder(a.project)
    if not c.delete_asset_if(asset_id, a.overwrite):
        if not test:
            c.record_asset("exposure_stack_asset", asset_id)
        return 0
    geom = c.thailand_geometry(bbox)

    pop = (ee.ImageCollection(ds["population"]).filter(ee.Filter.eq("year", 2020))
           .mosaic().select("population").rename("pop"))

    # buildings
    ob = ee.FeatureCollection(ds["buildings"])
    n_test = 0 if a.force_ghsl else ob.filterBounds(c.thailand_geometry(COVERAGE_TEST_BBOX)).limit(10).size().getInfo()
    source = choose_building_source(n_test)
    c.log.info("Open Buildings test count in %s = %s -> building_source=%s", COVERAGE_TEST_BBOX, n_test, source)
    if source == "open_buildings_v3":
        pts = ob.filterBounds(geom).filter(ee.Filter.gte("confidence", 0.7)).map(
            lambda f: ee.Feature(f.geometry().centroid(1), {"one": 1, "area": f.get("area_in_meters")}))
        bcount = pts.reduceToImage(["one"], ee.Reducer.sum()).rename("bldg_count")
        barea = pts.reduceToImage(["area"], ee.Reducer.sum()).rename("bldg_area")
    else:
        built = ee.Image(ee.ImageCollection(ds["ghsl_built"]).filter(ee.Filter.eq("system:index", "2020")).first()).select("built_surface")
        barea = built.rename("bldg_area")
        bcount = built.divide(footprint_m2()).rename("bldg_count")

    roads = [ee.FeatureCollection(f"{folder}/roads_{k}").filterBounds(geom).reduceToImage(["len_m"], ee.Reducer.sum())
             .rename(f"road_m_{k}") for k in ROAD_CLASSES]
    fac = ee.FeatureCollection(f"{folder}/facilities").filterBounds(geom)
    fac_imgs = [fac.filter(ee.Filter.eq("kind", kind)).map(lambda f: f.set("one", 1))
                .reduceToImage(["one"], ee.Reducer.sum()).rename(band) for kind, band in KIND_BAND.items()]

    from app.settings import assets
    osm_date = (assets().get("osm_date") or "unknown")
    img = (ee.Image.cat([pop, bcount, barea, *roads, *fac_imgs]).unmask(0).select(BANDS).float()
           .set({"sources": "WorldPop 2020 100m; " + ("Google Open Buildings v3 (conf>=0.7)" if source == "open_buildings_v3"
                                                      else "JRC GHSL P2023A built_surface 2020") + "; OpenStreetMap (Geofabrik)",
                 "run_date": c.today(), "osm_date": osm_date, "building_source": source,
                 "avg_footprint_m2": footprint_m2()}))
    task = ee.batch.Export.image.toAsset(image=img, description=f"lw_exposure_{a.region}", assetId=asset_id,
                                         region=geom, scale=100, crs="EPSG:4326", maxPixels=int(1e13),
                                         pyramidingPolicy={".default": "sum"})
    if a.no_wait:
        task.start()
        print(f"started task {task.id} -> {asset_id}")
        return 0
    c.start_export_and_wait(task)
    if not test:
        c.record_asset("exposure_stack_asset", asset_id)
        c.update_assets_local("building_source", source)
    else:
        print(f"ASSET (test, not recorded) {asset_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
