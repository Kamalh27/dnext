# Data scripts

Run from `apps/api`: `uv run [--group scripts] python ../../scripts/<script>.py [options]`. Scripts that read OpenStreetMap or build GeoJSON need `--group scripts`. Most take `--project` (default: the `EE_PROJECT` environment variable) and report what they do on the console.

## Tambon-level risk (default method)

| Script | When | What it does | Output |
|---|---|---|---|
| `build_risk_layer.py` | Once | Exports the rain-independent part of the risk (susceptibility × vulnerability × exposure classes) as a 100 m Earth Engine asset. Add `--no-wait` to start the task and return | `risk_static_asset` in `assets.local.yaml` |
| `precompute_static_stats.py` | Once | Per-tambon area and population for each value of the static risk product. `--bucket` also uploads it | `.local_storage/risk/static_stats.json` |
| `precompute_features.py` | Once | Built-up area, hospitals, schools and main roads per tambon and risk product. Needs `scripts/out/osm/thailand-latest.osm.pbf` from Geofabrik. Runs in cached steps: `geoms, osm, sample, ghsl, merge` | `.local_storage/risk/static_features.json` |
| `precompute_facilities.py` | Once | Named hospitals and schools that can reach a Low-or-higher risk, with location, tambon and risk product. Same Geofabrik extract. Needs the `geoms` step of `precompute_features.py` to have run | `.local_storage/risk/facilities.json` |
| `build_tambon_shapes.py` | Once | Simplified outlines of all 7,425 tambons, grouped by province, for the report map. Needs the `geoms` step of `precompute_features.py` | `.local_storage/risk/tambon_shapes.json` |
| `precompute_infrastructure.py` | Once | Buildings and main roads on ground that can reach Moderate risk. Steps: `cells` (100 m cells with buildings), `roadcells` (all such cells), `buildings` (Open Buildings inside the cells, with GHSL height), `roads` (OSM pieces near the cells), `merge`. Takes about 10 minutes. Needs the `geoms` step and the Geofabrik extract | `.local_storage/risk/infrastructure.json` |
| `precompute_shelters.py` | Once | Named OpenStreetMap places that could serve as shelters or help points (shelters and assembly points, community centres and town halls, schools and colleges, temples, hospitals) and that sit on ground with a static product below 25, so their risk stays below Low even at trigger 5. They are candidates, not a confirmed list. Needs the `geoms` step and the Geofabrik extract | `.local_storage/risk/shelters.json` |
| `build_provinces_geojson.py` | Once | Simplified outlines of the 77 provinces, built from the tambon table, for map clicks | `apps/web/public/provinces.json` |
| `daily_job.py` | Twice a day, in the cloud | The Cloud Run job: runs `precompute_rain.py`, appends the day to BigQuery (`app/history.py`) and publishes the Pub/Sub message that triggers alerts | BigQuery tables, Pub/Sub message |
| `precompute_rain.py` | Daily | Observed (GSMaP) and forecast (GFS) rainfall per tambon. `--bucket` also uploads it | `.local_storage/risk/obs_daily.json` |

`precompute_rain.py` runs in the cloud as a job; see `infra/deploy-job.sh`. Re-run the one-off scripts only when the susceptibility, vulnerability or exposure layers change. For production, upload the three JSON files to `gs://<project>-dnext/risk/`. Details are in [docs/risk_method.md](../docs/risk_method.md).

## Alternative screening method

These scripts support `HAZARD_MODEL=screening`. They write asset IDs to `apps/api/app/config/assets.local.yaml`, keep other keys and comments, and skip work whose asset already exists. Assets go under `projects/<EE_PROJECT>/assets/landslidewatch/`. Test exports (`--region nan`, `chiang_rai` or `mae_hong_son`) go to separate `*_test_<region>` assets that are not recorded.

| Script | What it does | Writes |
|---|---|---|
| `upload_admin.py --zip tha_admin_boundaries.shp.zip` | Uploads the administrative boundaries (HDX `cod-ab-tha`) as an Earth Engine asset. `--fallback geoboundaries` is the alternative | `tambon_asset`, `admin_index.json` |
| `fetch_osm.py --bucket <bucket>` | Downloads the Geofabrik extract and builds road and facility tables. Needs `osmium` (`brew install osmium-tool`) | `facilities_asset`, `osm_date` |
| `precompute_susceptibility.py` | Static susceptibility (about 1 to 3 hours for all of Thailand) | `susceptibility_asset` |
| `build_exposure_stack.py` | Population, buildings and roads as one image. Uses Open Buildings if the coverage check passes and GHSL otherwise | `exposure_stack_asset`, `building_source` |
| `validate_susceptibility.py [--lhasa lhasa.tif]` | Checks the susceptibility against the NASA landslide catalogue | `scripts/out/validation.md` |

## Notes

- You need `gcloud auth application-default login` (or a service-account key) and a project registered for Earth Engine.
- Roads are rasterised from pieces of about 100 m, so the metres per pixel are accurate to within one piece. Road classes are primary, secondary, tertiary, local and track.
- Pure-logic tests for the scripts: `cd apps/api && uv run pytest tests/test_scripts_pure.py`.
