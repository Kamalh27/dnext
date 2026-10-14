#!/usr/bin/env bash
# Two-phase deploy: api -> (read its URL) -> web -> lock api CORS to the web URL -> smoke test.
# Usage: infra/deploy.sh [--api-only|--web-only]   Needs: infra/config.env, .env (maps key + map id), infra/setup.sh run once.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . infra/config.env; [ -f .env ] && . ./.env; set +a
: "${PROJECT_ID:?}"; : "${REGION:=asia-southeast1}"
: "${NEXT_PUBLIC_GOOGLE_MAPS_API_KEY:?set in .env}"; : "${NEXT_PUBLIC_GOOGLE_MAP_ID:?set in .env}"
export CLOUDSDK_CORE_PROJECT="$PROJECT_ID"
MODE="${1:-all}"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
if [ -n "${RUNTIME_SA:-}" ]; then   # shared mode: existing runtime account, project-default Cloud Build account
  API_SA="$RUNTIME_SA"; WEB_SA="$PROJECT_NUMBER-compute@developer.gserviceaccount.com"; BUILD=""
else
  API_SA="dnext-api@$PROJECT_ID.iam.gserviceaccount.com"; WEB_SA="dnext-web@$PROJECT_ID.iam.gserviceaccount.com"
  BUILD="--service-account=projects/$PROJECT_ID/serviceAccounts/dnext-build@$PROJECT_ID.iam.gserviceaccount.com"
fi
BUILD="$BUILD --gcs-source-staging-dir=gs://$PROJECT_ID-dnext/build-src"
url() { gcloud run services describe "$1" --region "$REGION" --format='value(status.url)' 2>/dev/null || true; }

if [ "${AUTH_REQUIRED:-false}" = "true" ]; then
  for v in FIREBASE_API_KEY FIREBASE_AUTH_DOMAIN FIREBASE_APP_ID; do
    [ -n "${!v:-}" ] || { echo "AUTH_REQUIRED=true needs $v (Firebase console > Project settings > Your apps > Web app config)"; exit 1; }; done
fi
gcloud secrets describe maps-server-key >/dev/null 2>&1 || {
  echo "Secret maps-server-key missing: run infra/bootstrap.sh (or: printf %s \$KEY | gcloud secrets create maps-server-key --data-file=-)"; exit 1; }
gcloud artifacts repositories describe dnext --location "$REGION" >/dev/null 2>&1 || { echo "Run infra/setup.sh first (Artifact Registry repo 'dnext' missing)"; exit 1; }

if [ "$MODE" != "--web-only" ]; then
  echo "== build + deploy api"
  gcloud builds submit . $BUILD --config infra/cloudbuild-api.yaml --substitutions=\
_REGION="$REGION",_RUNTIME_SA="$API_SA",_EE_PROJECT="${EE_PROJECT:-$PROJECT_ID}",_MIN_INSTANCES="${MIN_INSTANCES_API:-1}",_MAX_INSTANCES="${MAX_INSTANCES_API:-5}",_AGENT_MODEL="${AGENT_MODEL:-gemini-3.5-flash}",_ALLOWED_ORIGINS="$(url dnext-web || true)",_AUTH_REQUIRED="${AUTH_REQUIRED:-false}",_FIREBASE_API_KEY="${FIREBASE_API_KEY:-}",_FIREBASE_AUTH_DOMAIN="${FIREBASE_AUTH_DOMAIN:-}",_FIREBASE_APP_ID="${FIREBASE_APP_ID:-}"
fi
API_URL="$(url dnext-api)"; [ -n "$API_URL" ] || { echo "dnext-api not deployed"; exit 1; }
echo "api: $API_URL"

if [ "$MODE" != "--api-only" ]; then
  echo "== build + deploy web (API_URL baked in)"
  # '|' delimiter (quoted: it is a shell pipe otherwise): the web account email contains '@' and form URLs contain , = ?
  gcloud builds submit . $BUILD --config infra/cloudbuild-web.yaml --substitutions="^|^_REGION=$REGION|_WEB_SA=$WEB_SA|_API_URL=$API_URL|_MAPS_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY|_MAP_ID=$NEXT_PUBLIC_GOOGLE_MAP_ID|_FEEDBACK_URL=${NEXT_PUBLIC_FEEDBACK_FORM_URL:-}"
  WEB_URL="$(url dnext-web)"; echo "web: $WEB_URL"
  echo "== lock api CORS to the web origin"
  gcloud run services update dnext-api --region "$REGION" --update-env-vars "^@^ALLOWED_ORIGINS=$WEB_URL" >/dev/null
  echo; echo "NEXT: add  $WEB_URL/*  to the Maps browser key's HTTP-referrer restrictions (Console > Credentials)."
fi
echo "== smoke test"; python3 infra/smoke_test.py "$API_URL" || echo "(smoke test failed: see above)"
