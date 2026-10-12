"""Export susceptibility S + 8 factor bands over Thailand (100 m) to <folder>/susceptibility.

  cd apps/api && uv run python ../../scripts/precompute_susceptibility.py --region nan   # fast test
  cd apps/api && uv run python ../../scripts/precompute_susceptibility.py                # full Thailand
"""
import _common as c


def build_image():
    from app.geo import ee_model
    f = ee_model.factors()
    s = ee_model.susceptibility(f)
    return ee_model.ee.Image.cat([s, f.select(ee_model.FACTOR_BANDS)])  # bands: S + 8 factors


def main(argv=None):
    c.setup_logging()
    p = c.base_parser(__doc__)
    p.add_argument("--region", choices=sorted(c.REGION_BBOXES), default="bbox")
    p.add_argument("--no-wait", action="store_true", help="start the task and return")
    a = p.parse_args(argv)
    project = c.require_project(a.project, a.dry_run)
    test = a.region != "bbox"
    asset_id = f"{c.asset_folder(project)}/susceptibility" + (f"_test_{a.region}" if test else "")
    bbox = c.region_bbox(a.region)
    c.log.info("export %s: region=%s bbox=%s scale=100m maxPixels=1e13 pyramiding=mean", asset_id, a.region, bbox)
    if a.dry_run:
        print(f"[dry-run] would export bands S + factor bands over {bbox} to {asset_id}")
        return 0
    ee = c.ee_init(a.project)
    c.ensure_folder(a.project)
    if not c.delete_asset_if(asset_id, a.overwrite):
        if not test:
            c.record_asset("susceptibility_asset", asset_id)
        return 0
    img = build_image().set({"run_date": c.today(), "region": a.region, "scale_m": 100})
    task = ee.batch.Export.image.toAsset(
        image=img, description=f"lw_susceptibility_{a.region}", assetId=asset_id,
        region=c.thailand_geometry(bbox), scale=100, crs="EPSG:4326", maxPixels=int(1e13),
        pyramidingPolicy={".default": "mean"})
    if a.no_wait:
        task.start()
        print(f"started task {task.id} -> {asset_id} (re-run later to record the asset)")
        return 0
    c.start_export_and_wait(task)
    if test:
        print(f"ASSET (test, not recorded) {asset_id}")
    else:
        c.record_asset("susceptibility_asset", asset_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
