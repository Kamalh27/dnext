# Data pipeline scripts (one-time)

All scripts: `cd apps/api && uv run --group scripts python ../../scripts/<script>.py [opts]`.
Common flags: `--project` (default env `EE_PROJECT`), `--dry-run` (print plan, no EE/GCS calls), `--overwrite`.
Each script is idempotent (skips if its asset exists), prints `ASSET <key> = <id>` and updates
`apps/api/app/config/assets.local.yaml` (other keys and comments preserved). Assets live in
`projects/<EE_PROJECT>/assets/landslidewatch/`.

## Run order

| # | Step | Command | Writes key | Runtime (est.) |
|---|------|---------|-----------|----------------|
| 1 | Infra | `infra/setup.sh` (APIs, SA, bucket `$PROJECT_ID-lw`) | - | minutes |
| 2 | Admin boundaries | `upload_admin.py --zip tha_admin_boundaries.shp.zip` (or `--fallback geoboundaries`) | `tambon_asset`, `admin_index.json` | 5-15 min |
| 3 | OSM | `fetch_osm.py --bucket $PROJECT_ID-lw` | `facilities_asset`, `osm_date` | download ~400 MB + 10-30 min extract + ingest |
| 4 | Susceptibility | `precompute_susceptibility.py --region nan` (test), then no `--region` | `susceptibility_asset` | test: ~5-15 min; full TH: ~1-3 h |
| 5 | Exposure stack | `build_exposure_stack.py --region nan` (test), then full | `exposure_stack_asset`, `building_source` | ~1-4 h (Open Buildings is heavy) |
| 6 | Validation | `validate_susceptibility.py [--lhasa lhasa.tif]` | - (writes `scripts/out/validation.md`) | ~2-5 min |

Test exports for `--region nan|chiang_rai|mae_hong_son` go to `*_test_<region>` assets and are NOT recorded in assets.local.yaml.
EE runtimes depend on the shared queue; use `--no-wait` for 4/5 and re-run later to record the asset.

## Manual data

- HDX admin boundaries (cod-ab-tha, ADM1-3, 77/928/7425): https://data.humdata.org/dataset/cod-ab-tha ->
  `tha_admin_boundaries.shp.zip` (or pass `--url`).
- LHASA global GeoTIFF (optional, for rank correlation): NASA LHASA download page.
- Needs `osmium` CLI (`brew install osmium-tool`) for step 3; otherwise `pip install pyrosm` is used (more RAM).
- Needs `gcloud auth application-default login` and `earthengine` registration of the project.

## Notes / limitations

- Roads are rasterised from ~100 m piece midpoints (CSV tables `roads_<class>` with `len_m`), so metres-per-pixel is
  accurate to within one piece; classes: primary (motorway/trunk/primary), secondary, tertiary, local
  (unclassified/residential/service), track.
- Building source: Open Buildings v3 (confidence >= 0.7) if the coverage check over Nan finds buildings; else GHSL
  `GHS_BUILT_S` 2020 with count = area / 60 m2. Recorded in image property `building_source`.
- Tests: `cd apps/api && uv run pytest tests/test_scripts_pure.py` (pure logic only).
