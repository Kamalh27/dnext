#!/usr/bin/env bash
# One-time project setup. Usage: source infra/config.env; infra/setup.sh
# Safe for a shared project: it creates two dedicated service accounts and grants roles to THEM only.
# It never changes roles of the project's default Compute / Cloud Build accounts.
set -euo pipefail
: "${PROJECT_ID:?set PROJECT_ID in infra/config.env}"; : "${REGION:=asia-southeast1}"
SA=landslide-api; SA_EMAIL=$SA@$PROJECT_ID.iam.gserviceaccount.com      # runtime identity of the Cloud Run API (no key file)
BSA=lw-build;     BSA_EMAIL=$BSA@$PROJECT_ID.iam.gserviceaccount.com    # identity used by Cloud Build to build and deploy
BUCKET="$PROJECT_ID-lw"
export CLOUDSDK_CORE_PROJECT="$PROJECT_ID"   # scoped to this script; does not change your global gcloud config
bind() { gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$1" --role "roles/$2" --condition=None -q >/dev/null; }

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  aiplatform.googleapis.com earthengine.googleapis.com firestore.googleapis.com storage.googleapis.com \
  secretmanager.googleapis.com geocoding-backend.googleapis.com maps-backend.googleapis.com \
  cloudtrace.googleapis.com bigquery.googleapis.com \
  firebase.googleapis.com identitytoolkit.googleapis.com securetoken.googleapis.com

gcloud iam service-accounts create $SA  --display-name "LandslideWatch API (runtime)" || true
gcloud iam service-accounts create $BSA --display-name "LandslideWatch build and deploy" || true
WSA_EMAIL=lw-web@$PROJECT_ID.iam.gserviceaccount.com                      # identity of the web service: no roles at all
gcloud iam service-accounts create lw-web --display-name "LandslideWatch web (no roles)" || true
gcloud artifacts repositories create lw --repository-format=docker --location "$REGION" || true
gcloud firestore databases create --location "$REGION" || true
gsutil mb -l "$REGION" "gs://$BUCKET" || true

# Runtime account. Maps-key secrets are granted per secret by infra/bootstrap.sh, not project-wide.
for r in aiplatform.user serviceusage.serviceUsageConsumer earthengine.writer datastore.user logging.logWriter cloudtrace.agent; do
  bind "$SA_EMAIL" "$r"
done
gsutil iam ch "serviceAccount:$SA_EMAIL:objectAdmin" "gs://$BUCKET"

# Build account: only what a build + deploy needs.
bind "$BSA_EMAIL" logging.logWriter
bind "$BSA_EMAIL" run.developer
gcloud artifacts repositories add-iam-policy-binding lw --location "$REGION" \
  --member "serviceAccount:$BSA_EMAIL" --role roles/artifactregistry.writer -q >/dev/null
for t in "$SA_EMAIL" "$WSA_EMAIL"; do   # may deploy services running as these two accounts only
  gcloud iam service-accounts add-iam-policy-binding "$t" \
    --member "serviceAccount:$BSA_EMAIL" --role roles/iam.serviceAccountUser -q >/dev/null
done
gsutil iam ch "serviceAccount:$BSA_EMAIL:objectViewer" "gs://$BUCKET"                        # reads the uploaded build source

# auto-delete expired cache entries and daily usage counters (documents carry an expires_at timestamp)
gcloud firestore fields ttls update expires_at --collection-group=usage --enable-ttl --async || true
gcloud firestore fields ttls update expires_at --collection-group=scenarios --enable-ttl --async || true
echo "Next: store the Maps keys with infra/bootstrap.sh (it also grants the runtime account access to those secrets)."
echo "Earth Engine: ensure $PROJECT_ID is registered at https://code.earthengine.google.com/register"
