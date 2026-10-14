# Data sources

## Default method (tambon-level risk)

| Use | Data | Notes |
|---|---|---|
| Susceptibility | Landslide susceptibility map from ADPC | Band `b1`, values 0 to 100, 12 m |
| Vulnerability | Combined vulnerability index from ADPC | 0 to 0.50 across the country |
| Exposure | Combined exposure index from ADPC | 0.07 to 0.82 across the country |
| Rainfall thresholds and tambon boundaries | ADPC table of 7,425 tambon polygons | English and Thai names and codes, and the thresholds `P60max` to `P95max` (30-day rainfall in mm). These polygons are also the tambon boundary layer, so no separate administrative shapefile is needed for tambon ranking |
| Country boundary | Thailand with a 10 km buffer | |
| Observed rainfall | JAXA GSMaP (`JAXA/GPM_L3/GSMaP/v6/operational`) | NASA IMERG can be selected instead. The newest image is about a day old |
| Forecast rainfall | NOAA GFS (`NOAA/GFS0P25`) | Observed products have no forecast |
| Population | WorldPop 2020, 100 m (`WorldPop/GP/100m/pop`) | A modelled estimate, not a census count |
| Built-up area | GHSL built-up surface | Building counts are estimated from built-up area and an average footprint (`avg_footprint_m2` in `thresholds.yaml`) |
| Hospitals, schools, main roads | OpenStreetMap, from a Geofabrik Thailand extract | Only as complete as the OSM mapping, which is uneven in remote areas |
| Base map and place search | Google Maps Platform | |

The ADPC layers are read from Google Earth Engine. Their asset paths are project-specific. They are not stored in the repository. Put them in `apps/api/app/config/risk_layers.local.yaml`, using `risk_layers.local.yaml.example` as the template. The method is described in [risk_method.md](risk_method.md).

The agent model is `gemini-3.5-flash` on Vertex AI. An optional briefing model (`BRIEFING_MODEL`) is off by default, and briefings then come from a fixed template.

## Alternative screening method

These datasets are used only when `HAZARD_MODEL=screening`. Earth Engine IDs for them are in `apps/api/app/config/datasets.yaml`.

| Use | ID / value | Band(s) | Native resolution | Latency / vintage | Licence | Notes |
|---|---|---|---|---|---|---|
| DEM | `NASA/NASADEM_HGT/001` | `elevation` | 30 m | static (SRTM-era, 2000) | Public domain (NASA) | Slope and curvature via `ee.Terrain` and a Laplacian kernel. Canopy bias in forest. |
| Land cover | `ESA/WorldCover/v200` (`.first()`) | `Map` | 10 m | 2021 | CC BY 4.0 | Classes 10..100; scored in `weights.yaml` (`landcover_score`). |
| Forest loss | `UMD/hansen/global_forest_change_2025_v1_13` | `lossyear`, `treecover2000` | 30 m | through 2025 | CC BY 4.0 | Loss in the last 10 years where 2000 cover > 30 %. |
| Soil clay / sand | `OpenLandMap/SOL/SOL_CLAY-WFRACTION_USDA-3A1A1A_M/v02`, `.../SOL_SAND-WFRACTION_USDA-3A1A1A_M/v02` | `b0` (surface), `b30` | 250 m | static | CC BY 4.0 | Texture only. **No soil-depth layer for Asia** in EE, so depth is skipped. |
| Streams | `MERIT/Hydro/v1_0_1` | `upa` (upstream area, km2) | ~90 m | static | CC BY-NC 4.0 (check terms for non-research use) | Channels = `upa` > 5 km2; distance to channel. Fallback: HydroSHEDS 15ACC. |
| Lithology | none open in EE | - | - | - | - | **Skipped**, documented as a gap (see below). |
| Antecedent rain | `NASA/GPM_L3/IMERG_V07` | `precipitation` (mm/hr, 30-min images) | 0.1 deg (~10 km) | ~1 day behind real time | NASA open data | 15-day sum = images x 0.5 h. |
| Forecast rain | `NOAA/GFS0P25` | `total_precipitation_surface` | 0.25 deg (~25 km) | 4 runs/day, to 384 h | US Gov open data | Accumulates over `((F-1)%6)+1` h: sum the steps where `F%6==0` plus the remainder. |
| Historical rain | `UCSB-CHG/CHIRPS/DAILY` | `precipitation` | 0.05 deg | **1-2 months lag** | CC0 | Historical replay only, never "this week". |
| Population | `WorldPop/GP/100m/pop` year 2020 | `population` | 100 m | 2020 constrained/unconstrained model | CC BY 4.0 | Modelled, not a census count. |
| Buildings | `GOOGLE/Research/open-buildings/v3/polygons` | footprints | vector | 2023 | CC BY 4.0 / ODbL | **Thailand coverage unverified.** `build_exposure_stack.py` runs a coverage test (Nan) and falls back to `JRC/GHSL/P2023A/GHS_BUILT_S` (built-up m2, 100 m). |
| Admin boundaries | HDX `cod-ab-tha` ADM1-3 (77 / 928 / 7,425) | polygons | vector | HDX release | CC BY-IGO | Uploaded as our own EE asset by `scripts/upload_admin.py` (EE has **no ADM3**). Fallback geoBoundaries ADM1/2. |
| Roads / facilities | Geofabrik Thailand extract `thailand-latest.osm.pbf` | highways; school / hospital / shelter / bridge | vector, rasterised to 100 m | daily | ODbL | BigQuery `geo_openstreetmap` is **stale (Nov 2021)** so it is not used. Roads are rasterised as metres per pixel per class. |
| Validation | NASA Global Landslide Catalog (CSV, to 2016); LHASA global 1 km GeoTIFF | - | points / 1 km | static | NASA open data | - |
| Household size | 2.5 persons/household | - | national | 2025 census preliminary, news-reported | - | Config value `exposure.household_size`; always labelled "estimate". The source still needs to be confirmed. |
| Agent LLM | `gemini-3.5-flash` (Vertex AI, `asia-southeast1`, fallback `global`) | - | - | - | Google Cloud terms | Gemini 2.5 models retire 2026-10-20: not used. |
| Briefing LLM (optional) | `gemini-3.1-pro-preview` (`global` only, preview) | - | - | - | Google Cloud terms | Off by default (`BRIEFING_MODEL` empty = deterministic template). |
| Agent framework | `google-adk==2.11.*` | - | - | - | Apache 2.0 | `LlmAgent`, `Runner`, SSE streaming. |

### Known gaps

- **CHIRPS lag.** CHIRPS daily arrives 1-2 months late. Current-conditions wetness uses IMERG V07 (about 1 day lag); CHIRPS is only for replaying past events.
- **IMERG is coarse (about 10 km).** Antecedent wetness is therefore smooth; it can miss very local storms.
- **Open Buildings in Thailand is unverified.** The exposure script tests coverage and uses GHSL built-up surface otherwise; building *counts* then derive from an average footprint (`exposure` config) and are rougher.
- **OSM freshness.** BigQuery OSM is frozen at Nov 2021, so the Geofabrik extract is downloaded and processed offline. Roads and facilities are only as complete as OSM mapping, which is uneven in remote mountain areas.
- **No ADM3 in Earth Engine.** Tambon polygons come from HDX and are uploaded to our own asset.
- **Household size.** 2.5 comes from preliminary, news-reported 2025 census figures. We divide people by it and call the result an estimate.
- **No soil depth, no lithology.** Two of the strongest controls on landslide initiation are absent from open global data in EE. Susceptibility is therefore weaker than a site-investigated map, and this is stated in the tool output.
- **Single threshold.** The rainfall threshold defaults to the global Caine (1980) curve; it is not calibrated for Thailand (swappable in `thresholds.yaml`).
