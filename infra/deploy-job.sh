#!/usr/bin/env bash
# Builds the daily rainfall job, deploys it to Cloud Run and schedules it with Cloud Scheduler (06:30 and 18:30 Bangkok time).
# Usage: infra/deploy-job.sh [--run-now]     Needs: infra/config.env, infra/setup.sh run once, the layer config file in apps/api/app/config/.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . infra/config.env; set +a
: "${PROJECT_ID:?}"; : "${REGION:=asia-southeast1}"
export CLOUDSDK_CORE_PROJECT="$PROJECT_ID"
JOB=dnext-rain
if [ -n "${RUNTIME_SA:-}" ]; then   # shared mode (RUNTIME_SA in config.env): the project's default Cloud Build account builds
  BUILD="--gcs-source-staging-dir=gs://$PROJECT_ID-dnext/build-src"
else
  RUNTIME_SA="dnext-api@$PROJECT_ID.iam.gserviceaccount.com"
  BUILD="--service-account=projects/$PROJECT_ID/serviceAccounts/dnext-build@$PROJECT_ID.iam.gserviceaccount.com --gcs-source-staging-dir=gs://$PROJECT_ID-dnext/build-src"
fi
[ -f apps/api/app/config/risk_layers.local.yaml ] || { echo "apps/api/app/config/risk_layers.local.yaml is missing (see the .example file)"; exit 1; }

echo "== build + deploy job $JOB"
gcloud builds submit . $BUILD --config infra/cloudbuild-job.yaml \
  --substitutions="_REGION=$REGION,_JOB=$JOB,_RUNTIME_SA=$RUNTIME_SA,_EE_PROJECT=${EE_PROJECT:-$PROJECT_ID},_BUCKET=$PROJECT_ID-dnext"

echo "== schedule"
gcloud services enable cloudscheduler.googleapis.com >/dev/null
gcloud run jobs add-iam-policy-binding "$JOB" --region "$REGION" --member "serviceAccount:$RUNTIME_SA" --role roles/run.invoker -q >/dev/null
URI="https://run.googleapis.com/v2/projects/$PROJECT_ID/locations/$REGION/jobs/$JOB:run"
ARGS=(--location "$REGION" --schedule "30 6,18 * * *" --time-zone "Asia/Bangkok" --uri "$URI" --http-method POST --oauth-service-account-email "$RUNTIME_SA")
if gcloud scheduler jobs describe "$JOB-schedule" --location "$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$JOB-schedule" "${ARGS[@]}"
else
  gcloud scheduler jobs create http "$JOB-schedule" "${ARGS[@]}"
fi
echo "Scheduled: $JOB runs at 06:30 and 18:30 Bangkok time."
if [ "${1:-}" = "--run-now" ]; then
  echo "== first run"; gcloud run jobs execute "$JOB" --region "$REGION" --wait
fi
