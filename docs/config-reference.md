# Configuration reference

## API environment variables

Read by `apps/api/app/settings.py`, from the environment or from `.env`.

| Variable | Default | What it does |
|---|---|---|
| `PROJECT_ID` | empty | Google Cloud project for Firestore and Cloud Storage. The bucket is `<PROJECT_ID>-dnext` |
| `REGION` | `asia-southeast1` | Region for infrastructure |
| `EE_PROJECT` | empty | Earth Engine project. Required when `GEO_BACKEND=ee` |
| `EE_SERVICE_ACCOUNT_KEY` | empty | Path to a service-account key for local use. Empty means Application Default Credentials or the attached service account |
| `GEO_BACKEND` | `mock` | `mock` for fixed test data with no cloud calls, or `ee` for Earth Engine |
| `HAZARD_MODEL` | `tambon` | `tambon` for the tambon-level method, or `screening` for the weighted overlay |
| `AGENT_MODEL` | `gemini-3.5-flash` | Model for the chat agent |
| `BRIEFING_MODEL` | empty | Empty means briefings use a fixed template. Set a model name to polish them with Gemini |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Allowed CORS origins, comma separated |
| `MAX_REQUEST_BYTES` | `16384` | Request body size cap |
| `RATE_LIMIT` | `30/minute` | Per-client request limit |
| `REQUEST_TIMEOUT_S` | `60` | Timeout for ordinary requests. Chat streams are exempt |
| `AUTH_REQUIRED` | `false` | When true, chat, scenarios and forecasts need a Google sign-in |
| `FIREBASE_PROJECT_ID` | `PROJECT_ID` | Audience of the sign-in tokens |
| `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_APP_ID` | empty | The Firebase web app config. These are public identifiers, and the API hands them to the web app through `/auth/config` |
| `LIMIT_CHAT_PER_DAY` | `30` | Chats per account per day |
| `LIMIT_RUN_PER_DAY` | `200` | Scenario and forecast runs per account per day |
| `LIMIT_BURST_PER_MIN` | `6` | Requests per account per minute, per instance |
| `USAGE_TIMEZONE` | `Asia/Bangkok` | Daily counters reset at midnight in this zone |
| `GOOGLE_GENAI_USE_VERTEXAI` | `true` | Use Vertex AI rather than an API key |
| `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` | project, `global` | Used by the Gemini SDK |
| `GOOGLE_MAPS_SERVER_KEY` | unset | Turns on the geocoding fallback for places that are not in the built-in list. Read from the environment |
| `RISK_OBS_PATH`, `RISK_STATIC_STATS_PATH`, `RISK_STATIC_FEATURES_PATH`, `RISK_FACILITIES_PATH`, `RISK_SHAPES_PATH` | unset | Use a specific precomputed file instead of the local or Cloud Storage copy |

## Web environment variables

Set in `apps/web/.env.local` and baked in at build time (the Cloud Build web step takes them from `.env`).

| Variable | What it does |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | Address of the API |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Maps key for the browser |
| `NEXT_PUBLIC_GOOGLE_MAP_ID` | Map ID (vector rendering for 3D tilt) |
| `NEXT_PUBLIC_FEEDBACK_FORM_URL` | Feedback form opened by the header button |

## Infrastructure variables (`infra/config.env`)

`PROJECT_ID`, `REGION`, `EE_PROJECT`, `AGENT_MODEL`, `MIN_INSTANCES_API`, `MAX_INSTANCES_API`, and optionally `RUNTIME_SA`. Set `RUNTIME_SA` to an existing service account to run the API under it instead of creating a dedicated one.

## Files in `apps/api/app/config/`

| File | Committed | Purpose |
|---|---|---|
| `tambon_risk.yaml` | yes | The tambon-level method: class rules, scaling, trigger settings, the landslide-prone cut-offs (`landslide_prone`), layer styles |
| `risk_layers.local.yaml` | no | Earth Engine paths of the susceptibility, vulnerability, exposure, threshold and boundary layers. Template: `risk_layers.local.yaml.example` |
| `assets.local.yaml` | no | Written by the scripts. Holds `risk_static_asset` and other generated asset IDs. Template: `assets.local.yaml.example` |
| `thresholds.yaml` | yes | Input limits (rainfall up to 1,500 mm, duration 1 to 720 hours), average building footprint, household size |
| `admin_index.json` | yes | The 77 provinces with names, codes and bounding boxes, used to resolve place names |
| `datasets.yaml`, `weights.yaml` | yes | Datasets and weights for the alternative screening method |

## Deploying

Run `infra/setup.sh` once, then `infra/bootstrap.sh`, then `just deploy`. [README.md](../README.md) walks through the steps.

- `just deploy` builds and deploys `dnext-api`, reads its address, builds `dnext-web` with that address baked in, restricts the API's `ALLOWED_ORIGINS` to the web address and runs `infra/smoke_test.py`. `just deploy-api` and `just deploy-web` redeploy one service.
- The Cloud Build files read their settings from substitutions that `infra/deploy.sh` fills in. They contain no secrets. The Maps server key comes from Secret Manager (`maps-server-key`).
- `just deploy-job` (`infra/deploy-job.sh`) deploys the daily rainfall job `dnext-rain` and its schedule. It runs under the same service account as the API and writes `obs_daily.json` to the bucket.
- For local use only, `credentials/ee-sa.json` is gitignored. Cloud Run uses its attached service account.
- After the first web deploy, add the web address (`https://<web address>/*`) to the Maps key's allowed websites and the host to Firebase's authorised domains.
