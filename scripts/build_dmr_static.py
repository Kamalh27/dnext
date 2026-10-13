"""Precompute the rain-independent part of the DMR risk (susceptibility x vulnerability x exposure classes) as a 100 m asset.

Why: per-request tambon statistics over the three 12 m source rasters take ~17 s; over this single 100 m asset they take a few seconds.
Bands: prod (1..125), expo_class (1..5), expo (0..1). On success writes `dmr_static_asset` to assets.local.yaml.
Creates an Earth Engine asset in your project (storage), so it is never run implicitly.

  cd apps/api && uv run python ../../scripts/build_dmr_static.py --dry-run
  cd apps/api && uv run python ../../scripts/build_dmr_static.py
"""
import _common as c


def build_image():
    import ee
    from app.geo import dmr
    return ee.Image.cat([dmr.static_product(), dmr.exposure_class().rename("expo_class"), dmr.exposure_index().rename("expo")]).toFloat()


def main(argv=None):
    c.setup_logging()
    p = c.base_parser(__doc__)
    p.add_argument("--no-wait", action="store_true", help="start the task and return")
    a = p.parse_args(argv)
    project = c.require_project(a.project, a.dry_run)
    asset_id = f"{c.asset_folder(project)}/dmr_static"
    c.log.info("export %s: 100 m, bands prod/expo_class/expo", asset_id)
    if a.dry_run:
        print(f"[dry-run] would export prod + expo_class + expo at 100 m over Thailand to {asset_id}")
        return 0
    ee = c.ee_init(a.project)
    c.ensure_folder(a.project)
    if not c.delete_asset_if(asset_id, a.overwrite):
        c.record_asset("dmr_static_asset", asset_id)
        return 0
    from app.geo import dmr
    region = ee.FeatureCollection(dmr.cfg()["assets"]["boundary"]).geometry()
    task = ee.batch.Export.image.toAsset(
        image=build_image().set({"run_date": c.today(), "scale_m": 100}), description="lw_dmr_static", assetId=asset_id,
        region=region, scale=100, crs="EPSG:4326", maxPixels=int(1e13),
        pyramidingPolicy={"prod": "mode", "expo_class": "mode", "expo": "mean"})
    if a.no_wait:
        task.start()
        print("started task", task.id)
        return 0
    c.start_export_and_wait(task)
    c.record_asset("dmr_static_asset", asset_id)
    print("done:", asset_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
