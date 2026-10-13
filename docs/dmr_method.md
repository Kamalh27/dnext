# DMR / ADPC tambon-level landslide risk (default hazard model)

Selected with `HAZARD_MODEL=dmr` (default). The earlier weighted-overlay model remains available as `HAZARD_MODEL=screening`.
Config: `apps/api/app/config/dmr.yaml`. Code: `app/geo/dmr.py` (Earth Engine), `app/geo/dmr_backend.py` (service interface).

## Method
`Risk = Trigger x Susceptibility x Vulnerability x Exposure / 125` (range 0-5)

| Factor | Source | Class (1-5) |
|---|---|---|
| Trigger (0-5) | Tambon 30-day rainfall vs that tambon's DMR percentile thresholds `P60/P70/P80/P90/P95max` (7,425 tambon polygons, `projects/<project>/assets/<asset>`) | highest threshold exceeded; below P60 = 0 |
| Susceptibility | ADPC CNN map `dmr_cnn_landslide_susceptibility_60_int`, 0-100, 12 m. Pixels `< 10` are masked | z-score ("Standardize") on pixels >= 10: breaks at mean + k*sd, k = -1.5, -0.5, 0.5, 1.5 |
| Vulnerability | `<project>/.../combined_vulnerability_index`, 0-0.50 nationally | `ceil(v * 10)`, clamp 1-5 |
| Exposure | `<project>/.../exposure_combined`, 0.07-0.82 nationally | `ceil(e * 5)`, clamp 1-5 |

National statistics used (computed 2026-10-13 at 1 km, susceptibility >= 10): mean 41.379, sd 19.861; vulnerability max 0.5006 (so x10 is correct); exposure max 0.8187 (x5).
All assets are public and cleared for use. `GET /readyz` checks that the running identity can read every asset.

## Rainfall
* What-if (X mm over D hours): the 30-day total = observed rainfall of the preceding `30 - ceil(D/24)` days + X, applied uniformly. **Needs confirmation by DMR.**
* Forecast (H days): observed preceding `30 - H` days + NOAA GFS accumulated forecast for the next H days. IMERG itself is observation-only, so GFS supplies the forecast.
* Observed source: NASA IMERG (as requested). **The DMR thresholds were derived from JAXA GSMaP**, so IMERG-based classes can be biased; set `trigger.observed_source: gsmap` to match the thresholds exactly.
* The observed per-tambon means are cached; scenario rainfall is added in Python, so changing the slider does not repeat the observed-rain computation.

## Outputs
* Layers (event `map_layers`): risk (default visible), trigger class, 30-day rainfall, susceptibility, vulnerability, exposure.
* Tambon table: tambon, amphoe, trigger class, 30-day rain, peak risk, share of tambon in the elevated zone, exposure class, people in the elevated zone (WorldPop 2020).
* "Elevated" = risk class >= 3 (risk value >= 2). At national class breaks almost no pixel reaches High (>= 3); Nan peaks near 2.4 even with 300 mm, so counting High only would report 0 for most provinces (`risk.exposure_from`).
* Buildings, roads and facilities are not part of the DMR layers and are reported as unavailable (`null`), never as 0.

## Deviations from the reference script
* A tambon with a missing threshold gets trigger class 0. The script's `safeNum` would turn a null threshold into 0, so any rain gave class 5.
* Class breaks come from stored national statistics, not a per-request reduction (the script's per-request statistics would take minutes).
* Trigger classes are computed once and fed to the rasters as a lookup, so the rainfall reduction is not repeated downstream.

## Performance (Nan, real Earth Engine)
First what-if ~34 s; slider change ~24 s; 5-day forecast ~39 s. Most of the time is the tambon statistics over the 12 m source rasters.
Build the precomputed 100 m static layer to cut this: `cd apps/api && uv run python ../../scripts/build_dmr_static.py` (creates an Earth Engine asset in `EE_PROJECT`; records `dmr_static_asset`).

## Open items
* DMR to confirm the what-if semantics and the elevated-risk threshold.
* Daily precompute of the national trigger table (for a default "current conditions" view).
