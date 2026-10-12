#!/usr/bin/env bash
# One-time project setup. Usage: source infra/config.env; infra/setup.sh
set -euo pipefail
: "${PROJECT_ID:?set PROJECT_ID in infra/config.env}"; : "${REGION:=asia-southeast1}"
SA=landslide-api; SA_EMAIL=$SA@$PROJECT_ID.iam.gserviceaccount.com
gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  aiplatform.googleapis.com earthengine.googleapis.com firestore.googleapis.com storage.googleapis.com \
  secretmanager.googleapis.com geocoding-backend.googleapis.com maps-backend.googleapis.com \
  cloudtrace.googleapis.com bigquery.googleapis.com
gcloud iam service-accounts create $SA --display-name "LandslideWatch API" || true
for r in aiplatform.user serviceusage.serviceUsageConsumer earthengine.writer datastore.user \
         secretmanager.secretAccessor logging.logWriter cloudtrace.agent; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$SA_EMAIL" --role "roles/$r" --condition=None -q >/dev/null
done
gcloud artifacts repositories create lw --repository-format=docker --location "$REGION" || true
gcloud firestore databases create --location "$REGION" || true
gsutil mb -l "$REGION" "gs://$PROJECT_ID-lw" || true
gsutil iam ch "serviceAccount:$SA_EMAIL:objectAdmin" "gs://$PROJECT_ID-lw"
echo "Next: store the Maps key:  printf %s \$KEY | gcloud secrets create maps-key --data-file=-"
echo "Earth Engine: ensure $PROJECT_ID is registered at https://code.earthengine.google.com/register"
