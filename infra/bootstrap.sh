#!/usr/bin/env bash
# One-command orchestration once infra/config.env is filled.
#   infra/bootstrap.sh                 check prerequisites, run infra/setup.sh, store Maps key, print next commands
#   infra/bootstrap.sh --run-pipeline  also run the long data scripts (admin upload, susceptibility, exposure)
#   infra/bootstrap.sh --deploy        also run `make deploy`
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
  "$RUN/upload_admin.py --zip \"\${HDX_ZIP:?download HDX cod-ab-tha shapefile zip, export HDX_ZIP=path}\" --bucket $BUCKET   # ADM1-3 -> EE asset + app/config/admin_index.json"
  "$RUN/fetch_osm.py --bucket $BUCKET                 # Geofabrik roads + facilities (needs osmium-tool)"
  "$RUN/precompute_susceptibility.py --region nan     # fast test export; omit --region for all Thailand"
  "$RUN/build_exposure_stack.py --region nan          # fast test; omit --region for all Thailand"
  "$RUN/validate_susceptibility.py                    # GLC AUC -> scripts/out/validation.md"
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
  echo "== make deploy"
  : "${API_URL:=}"; export API_URL MAPS_KEY MAP_ID="${MAP_ID:-${NEXT_PUBLIC_GOOGLE_MAP_ID:-}}"
  [ -n "$API_URL" ] || echo "  note: API_URL empty (first deploy). After the api deploys, set API_URL=<url> and run 'make deploy' again so the web build points at it."
  make deploy
else
  echo; echo "Deploy when ready: API_URL=<api url or empty on first run> MAPS_KEY=\$MAPS_KEY MAP_ID=<map id> make deploy"
  echo "Smoke test:       python infra/smoke_test.py https://<api-url>"
fi
