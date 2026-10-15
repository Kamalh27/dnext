#!/usr/bin/env bash
# History and alerts plumbing: the BigQuery dataset, the Pub/Sub topic and the push subscription that calls the API.
# Run once after the API is deployed (it needs the API address):  bash infra/setup-alerts.sh
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . infra/config.env; set +a
: "${PROJECT_ID:?}"; : "${REGION:=asia-southeast1}"
export CLOUDSDK_CORE_PROJECT="$PROJECT_ID"
SA="${RUNTIME_SA:-dnext-api@$PROJECT_ID.iam.gserviceaccount.com}"
TOPIC=dnext-new-data
SUB=dnext-new-data-push
API_URL="$(gcloud run services describe dnext-api --region "$REGION" --format='value(status.url)')"
[ -n "$API_URL" ] || { echo "dnext-api is not deployed yet: run just deploy first"; exit 1; }
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

echo "== APIs"
gcloud services enable pubsub.googleapis.com bigquery.googleapis.com >/dev/null

echo "== BigQuery dataset"
bq --project_id="$PROJECT_ID" mk -d --location="$REGION" dnext 2>/dev/null || echo "  (dataset dnext already exists)"

echo "== Pub/Sub topic and push subscription"
gcloud pubsub topics create "$TOPIC" 2>/dev/null || echo "  (topic already exists)"
# Pub/Sub signs the push request as the invoker account, so its service agent must be allowed to create tokens for it
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --member "serviceAccount:service-$PROJECT_NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com" --role roles/iam.serviceAccountTokenCreator -q >/dev/null
ARGS=(--topic "$TOPIC" --push-endpoint "$API_URL/internal/new-data" --push-auth-service-account "$SA" --push-auth-token-audience "$API_URL" --ack-deadline 120)
if gcloud pubsub subscriptions describe "$SUB" >/dev/null 2>&1; then
  gcloud pubsub subscriptions update "$SUB" --push-endpoint "$API_URL/internal/new-data" --push-auth-service-account "$SA" --push-auth-token-audience "$API_URL" --ack-deadline 120
else
  gcloud pubsub subscriptions create "$SUB" "${ARGS[@]}"
fi

echo "== tell the API who may call it"
gcloud run services update dnext-api --region "$REGION" --update-env-vars "PUBSUB_AUDIENCE=$API_URL,PUBSUB_INVOKER_SA=$SA" >/dev/null
echo "Done. The daily job now writes history to BigQuery and publishes to $TOPIC after every run."
