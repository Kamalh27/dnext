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
url() { gcloud run services describe "$1" --region "$REGION" --format='value(status.url)' 2>/dev/null || true; }

gcloud secrets describe session-secret >/dev/null 2>&1 || {
  echo "Secret session-secret missing: run infra/bootstrap.sh (it generates one) or: openssl rand -base64 48 | gcloud secrets create session-secret --data-file=-"; exit 1; }
if [ "${AUTH_REQUIRED:-false}" = "true" ] && [ -z "${GOOGLE_OAUTH_CLIENT_ID:-}" ]; then
  echo "AUTH_REQUIRED=true needs GOOGLE_OAUTH_CLIENT_ID (APIs & Services > Credentials > OAuth client ID > Web)"; exit 1; fi
gcloud secrets describe maps-server-key >/dev/null 2>&1 || {
  echo "Secret maps-server-key missing: run infra/bootstrap.sh (or: printf %s \$KEY | gcloud secrets create maps-server-key --data-file=-)"; exit 1; }
gcloud artifacts repositories describe lw --location "$REGION" >/dev/null 2>&1 || { echo "Run infra/setup.sh first (Artifact Registry repo 'lw' missing)"; exit 1; }

if [ "$MODE" != "--web-only" ]; then
  echo "== build + deploy api"
  gcloud builds submit . --config infra/cloudbuild-api.yaml --substitutions=\
_REGION="$REGION",_MIN_INSTANCES="${MIN_INSTANCES_API:-1}",_MAX_INSTANCES="${MAX_INSTANCES_API:-5}",_AGENT_MODEL="${AGENT_MODEL:-gemini-3.5-flash}",_ALLOWED_ORIGINS="$(url lw-web || true)",_AUTH_REQUIRED="${AUTH_REQUIRED:-false}",_GOOGLE_CLIENT_ID="${GOOGLE_OAUTH_CLIENT_ID:-}"
fi
API_URL="$(url lw-api)"; [ -n "$API_URL" ] || { echo "lw-api not deployed"; exit 1; }
echo "api: $API_URL"

if [ "$MODE" != "--api-only" ]; then
  echo "== build + deploy web (API_URL baked in)"
  gcloud builds submit . --config infra/cloudbuild-web.yaml --substitutions=\
^@^_REGION="$REGION"@_API_URL="$API_URL"@_MAPS_KEY="$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"@_MAP_ID="$NEXT_PUBLIC_GOOGLE_MAP_ID"@_FEEDBACK_URL="${NEXT_PUBLIC_FEEDBACK_FORM_URL:-}"   # '@' delimiter: form URLs contain , = ?
  WEB_URL="$(url lw-web)"; echo "web: $WEB_URL"
  echo "== lock api CORS to the web origin"
  gcloud run services update lw-api --region "$REGION" --update-env-vars "^@^ALLOWED_ORIGINS=$WEB_URL" >/dev/null
  echo; echo "NEXT: add  $WEB_URL/*  to the Maps browser key's HTTP-referrer restrictions (Console > Credentials)."
fi
echo "== smoke test"; python3 infra/smoke_test.py "$API_URL" || echo "(smoke test failed: see above)"
