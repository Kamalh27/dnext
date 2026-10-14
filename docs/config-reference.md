# Configuration reference

## PLUG-IN CHECKLIST (once the GCP project, Earth Engine and a Maps key exist)

Work through in order. Everything runs in **mock mode** (`GEO_BACKEND=mock`) before this; nothing here is needed for local UI/agent work.

1. **Fill the config.**
   ```bash
   cp infra/config.env.example infra/config.env     # set PROJECT_ID, EE_PROJECT (may equal PROJECT_ID), REGION
   cp .env.example .env                              # set PROJECT_ID, EE_PROJECT, GOOGLE_CLOUD_PROJECT, Maps key/map id
   ```
2. **Authenticate.**
   ```bash
   gcloud auth login
   gcloud auth application-default login --scopes=https://www.googleapis.com/auth/earthengine,https://www.googleapis.com/auth/cloud-platform
   ```
3. **Register Earth Engine for the project** (once): https://code.earthengine.google.com/register , and accept the licence type (non-commercial/ research vs commercial).
4. **Create a Maps key** (Cloud Console > APIs & Services > Credentials): browser key restricted by HTTP referrer to Maps JavaScript API; create a **Map ID** (Map Management, vector) for AdvancedMarker. Optional second, server key restricted to Geocoding API.
5. **One command bootstrap** (checks prerequisites, enables APIs, service account, Artifact Registry, Firestore, bucket, stores the Maps key in Secret Manager):
   ```bash
   export MAPS_KEY=<browser key>
   infra/bootstrap.sh
   ```
6. **Switch local to the real backend and verify EE:**
   ```bash
   sed -i '' 's/^GEO_BACKEND=.*/GEO_BACKEND=ee/' .env     # Linux: sed -i
   cd apps/api && EE_PROJECT=<ee project> uv run python -c "import ee; ee.Initialize(project='<ee project>'); print(ee.Number(1).add(1).getInfo())"
   ```
7. **Data pipeline** (from `apps/api`; EE exports are long-running and continue server-side; each script writes IDs into `app/config/assets.local.yaml`, and `upload_admin.py` writes `app/config/admin_index.json`). Smoke-test each with `--region nan` before the full country:
   ```bash
   cd apps/api
   uv run --group scripts python ../../scripts/upload_admin.py --zip ~/Downloads/tha_admin_boundaries.shp.zip --bucket $PROJECT_ID-dnext
   uv run --group scripts python ../../scripts/fetch_osm.py --bucket $PROJECT_ID-dnext
   uv run python ../../scripts/precompute_susceptibility.py            # add --region nan to test first
   uv run python ../../scripts/build_exposure_stack.py                 # add --region nan to test first
   uv run --group scripts python ../../scripts/validate_susceptibility.py
   ```
   (`infra/bootstrap.sh --run-pipeline` runs these.) Open the Tasks tab in the EE Code Editor to watch exports.
8. **Optional Geocoding fallback** for places not in the admin index: `export GOOGLE_MAPS_SERVER_KEY=<server key>` locally (or `--update-secrets` / `--set-env-vars` on Cloud Run; `infra/cloudbuild-api.yaml` mounts it from the `maps-server-key` secret).
9. **Deploy.** First run builds the api; set `API_URL` to its URL, then deploy again so the web build points at it:
   ```bash
   gcloud run services describe dnext-api --region asia-southeast1 --project $PROJECT_ID --format='value(status.url)'
   API_URL=<that url> MAPS_KEY=$MAPS_KEY MAP_ID=<map id> make deploy     # or: infra/bootstrap.sh --deploy
   ```
10. **Add the web origin to CORS** and redeploy the api env: `ALLOWED_ORIGINS=https://<dnext-web url>`.
11. **Smoke test and warm the cache:**
    ```bash
    python infra/smoke_test.py https://<dnext-api url>
    ```
    Then run the three demo prompts once so Firestore holds them.

## Environment variables (API; read by `app/settings.py`)

| Variable | Default | Purpose |
|---|---|---|
| `PROJECT_ID` | "" | GCP project for Firestore/GCS (bucket `<PROJECT_ID>-dnext`). |
| `REGION` | `asia-southeast1` | Region for infra and Vertex. |
| `EE_PROJECT` | "" | Earth Engine-registered Cloud project; required when `GEO_BACKEND=ee`. |
| `GEO_BACKEND` | `mock` | `mock` (deterministic fixtures, zero cloud) or `ee`. |
| `AGENT_MODEL` | `gemini-3.5-flash` | Agent LLM (Vertex). Avoid 2.5 models (retire 2026-10-20). |
| `BRIEFING_MODEL` | "" | Empty = deterministic briefing template; e.g. `gemini-3.1-pro-preview` (needs `global` location). |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated CORS origins. |
| `MAX_REQUEST_BYTES` | 16384 | Request body cap. |
| `RATE_LIMIT` | `30/minute` | slowapi limit. |
| `REQUEST_TIMEOUT_S` | 60 | Per-request timeout. |
| `GOOGLE_GENAI_USE_VERTEXAI` | `true` | ADK/GenAI: use Vertex instead of API key. |
| `GOOGLE_CLOUD_PROJECT` | = `PROJECT_ID` | Used by the GenAI SDK. |
| `GOOGLE_CLOUD_LOCATION` | `global` | Gemini location (`global` or `asia-southeast1`). |
| `GOOGLE_APPLICATION_CREDENTIALS` | (compose sets) | ADC file for local docker. Not needed on Cloud Run. |
| `GOOGLE_MAPS_SERVER_KEY` | unset | Enables the Geocoding fallback in `areas.py`; read from the process environment (not `.env` unless exported or passed by compose). |

Web build args (`apps/web`): `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAP_ID`. Infra (`infra/config.env`): `PROJECT_ID`, `REGION`, `EE_PROJECT`, `AGENT_MODEL`. Bootstrap/deploy: `MAPS_KEY`, `MAP_ID`, `API_URL`, `HDX_ZIP`.

## YAML keys (`apps/api/app/config/`)

**`datasets.yaml`**: Earth Engine IDs `dem`, `landcover`, `forest`, `soil_clay`, `soil_sand`, `hydro`, `imerg`, `gfs`, `population`, `buildings`, `ghsl_built`, plus own-asset slots `susceptibility_asset`, `exposure_stack_asset`, `tambon_asset`. See `docs/data_sources.md`.

**`assets.local.yaml`**: written by `scripts/`; non-empty values override `datasets.yaml`. Keys `susceptibility_asset`, `exposure_stack_asset`, `tambon_asset`, `facilities_asset`. Empty means the API falls back to on-the-fly compute.

**`admin_index.json`**: written by `scripts/upload_admin.py`; list of `{level, pcode, name_en, name_th, bbox, parent_pcode}`. Absent = built-in 77-province table (approximate boxes).

**`weights.yaml`**: `weights.*` (sum 1), `normalisation.{slope_deg,curvature,stream_dist_m,channel_upa_km2}`, `landcover_score` by WorldCover class. Rationale in `docs/method.md`.

**`thresholds.yaml`**: `intensity_duration.{name,alpha,beta}` (Caine 14.82, -0.39); `antecedent.{days,reference_mm}` (15, 300); `hazard.{k,antecedent_gain,class_cutoffs,class_names,class_colors}` (1.2, 0.5, [0.15,0.35,0.60]); `limits.{rainfall_mm_max,duration_h_min,duration_h_max}` (1500, 1, 720); `exposure.household_size` (2.5).

## Deploy flow (infra/deploy.sh)
Order: `infra/config.env` (PROJECT_ID, REGION, EE_PROJECT) → `infra/setup.sh` once (APIs, `dnext-api` service account + roles, Cloud Build roles, Artifact Registry `lw`, Firestore, bucket `$PROJECT_ID-dnext`) → `infra/bootstrap.sh` (Secret Manager: `maps-key`, `maps-server-key`) → `just deploy`.

- `just deploy` = `infra/deploy.sh`: builds + deploys `dnext-api` (Cloud Run, attached SA, **no key file in the image**, min-instances from `MIN_INSTANCES_API`), reads its URL, builds `dnext-web` with that URL baked in (`NEXT_PUBLIC_*` come from `.env`), then locks the api's `ALLOWED_ORIGINS` to the web URL and runs `infra/smoke_test.py`.
- `just deploy-api` / `just deploy-web` redeploy one service. `just smoke <url>` re-runs the smoke test.
- After the first web deploy, add the printed web URL (`https://dnext-web-….run.app/*`) to the Maps **browser key's HTTP referrer** list.
- Local-only: `EE_SERVICE_ACCOUNT_KEY=credentials/ee-sa.json` (gitignored). Cloud Run uses its attached service account instead.
