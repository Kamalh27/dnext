#!/usr/bin/env bash
# One-command orchestration once infra/config.env is filled.
#   infra/bootstrap.sh                 check prerequisites, run infra/setup.sh, store Maps key, print next commands
#   infra/bootstrap.sh --run-pipeline  also run the data scripts that build the precomputed files (see README, step 3)
#   infra/bootstrap.sh --deploy        also run infra/deploy.sh
# Idempotent: safe to re-run. Maps key comes from env MAPS_KEY (or NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in .env).
set -euo pipefail
cd "$(dirname "$0")/.."

RUN_PIPELINE=0; DEPLOY=0
for a in "$@"; do
  case "$a" in
    --run-pipeline) RUN_PIPELINE=1 ;;
    --deploy) DEPLOY=1 ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "Unknown option: $a" >&2; exit 2 ;;
  esac
done

die() { echo "ERROR: $*" >&2; exit 1; }
ok()  { echo "  ok  $*"; }

[ -f infra/config.env ] || die "infra/config.env missing. Run: cp infra/config.env.example infra/config.env and fill PROJECT_ID / EE_PROJECT."
set -a; . infra/config.env; set +a
[ -f .env ] && { set -a; . ./.env; set +a; } || true
: "${PROJECT_ID:?Set PROJECT_ID in infra/config.env}"
: "${EE_PROJECT:?Set EE_PROJECT in infra/config.env (may equal PROJECT_ID)}"
: "${REGION:=asia-southeast1}"
MAPS_KEY="${MAPS_KEY:-${NEXT_PUBLIC_GOOGLE_MAPS_API_KEY:-}}"

echo "== Prerequisites"
for c in gcloud gsutil uv; do command -v "$c" >/dev/null || die "'$c' not found on PATH."; done
ok "gcloud, gsutil, uv installed"
gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q . \
  || die "No active gcloud account. Run: gcloud auth login"
ok "gcloud account active"
gcloud auth application-default print-access-token >/dev/null 2>&1 \
  || die "No Application Default Credentials. Run: gcloud auth application-default login"
ok "ADC present"
[ -n "$MAPS_KEY" ] || die "Maps key missing. Run: export MAPS_KEY=<your browser key> (Maps JavaScript API + Geocoding enabled)"
ok "Maps key present"

echo "== Earth Engine project check ($EE_PROJECT)"
(cd apps/api && EE_PROJECT="$EE_PROJECT" uv run python - <<'PY'
import os, sys, ee
try:
    ee.Initialize(project=os.environ["EE_PROJECT"])
    v = ee.Number(1).add(1).getInfo()
    assert v == 2
except Exception as e:
    sys.exit(f"Earth Engine init failed: {e}\n"
             f"Register the project at https://code.earthengine.google.com/register and enable the Earth Engine API, "
             f"then re-run. (Also: gcloud auth application-default login --scopes=https://www.googleapis.com/auth/earthengine,https://www.googleapis.com/auth/cloud-platform)")
PY
) || die "Earth Engine check failed (see above)."
ok "Earth Engine call succeeded"

echo "== infra/setup.sh (APIs, service account, Artifact Registry, Firestore, bucket)"
bash infra/setup.sh

put_secret() {  # name value
  if gcloud secrets describe "$1" --project "$PROJECT_ID" >/dev/null 2>&1; then
    printf %s "$2" | gcloud secrets versions add "$1" --data-file=- --project "$PROJECT_ID" >/dev/null
    ok "$1: new version added"
  else
    printf %s "$2" | gcloud secrets create "$1" --data-file=- --replication-policy=automatic --project "$PROJECT_ID" >/dev/null
    ok "$1: created"
  fi
  # runtime account reads only these secrets (no project-wide secretAccessor)
  gcloud secrets add-iam-policy-binding "$1" --project "$PROJECT_ID" \
    --member "serviceAccount:${RUNTIME_SA:-dnext-api@$PROJECT_ID.iam.gserviceaccount.com}" --role roles/secretmanager.secretAccessor -q >/dev/null
}
echo "== Maps keys -> Secret Manager"
put_secret maps-key "$MAPS_KEY"                       # browser key (referrer-restricted)
# Server-side Geocoding fallback needs an API-restricted key WITHOUT referrer restriction; falls back to MAPS_KEY.
put_secret maps-server-key "${MAPS_SERVER_KEY:-$MAPS_KEY}"

BUCKET="${PROJECT_ID}-dnext"
RUN="uv run --group scripts python ../../scripts"
PIPE=(
  "$RUN/build_risk_layer.py --project $EE_PROJECT            # one-off: 100 m static layer as an Earth Engine asset"
  "$RUN/precompute_static_stats.py --bucket $BUCKET          # one-off: per-tambon statistics"
  "$RUN/build_provinces_geojson.py                           # one-off: province outlines for the map"
  "$RUN/precompute_features.py                               # one-off: buildings, hospitals, schools, roads (needs the Geofabrik extract)"
  "$RUN/precompute_facilities.py                             # one-off: named hospitals and schools at risk"
  "$RUN/build_tambon_shapes.py                               # one-off: tambon outlines for the report map"
  "$RUN/precompute_infrastructure.py                         # one-off: buildings and main roads that can reach Moderate risk"
  "$RUN/precompute_shelters.py                               # one-off: candidate safe places on very-low-risk ground"
  "gcloud storage cp .local_storage/risk/static_features.json .local_storage/risk/facilities.json .local_storage/risk/tambon_shapes.json .local_storage/risk/infrastructure.json .local_storage/risk/shelters.json gs://$BUCKET/risk/   # upload the features files"
  "$RUN/precompute_rain.py --bucket $BUCKET                  # daily: rainfall per tambon"
)
echo
if [ "$RUN_PIPELINE" = 1 ]; then
  echo "== Running data pipeline (long jobs; EE exports continue server-side)"
  for cmd in "${PIPE[@]}"; do c="${cmd%%   #*}"; echo "+ $c"; (cd apps/api && eval "$c"); done
else
  echo "== Next: data pipeline (NOT run automatically; add --run-pipeline to run). Run from apps/api (EE_PROJECT=$EE_PROJECT is in env):"
  for cmd in "${PIPE[@]}"; do echo "   (cd apps/api && $cmd)"; done
fi

if [ "$DEPLOY" = 1 ]; then
  echo "== deploy"
  bash infra/deploy.sh
else
  echo; echo "Deploy when ready: just deploy   (or bash infra/deploy.sh)"
  echo "Smoke test:        python infra/smoke_test.py https://<api-url>"
fi
