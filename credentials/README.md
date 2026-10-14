# credentials/ (local development only — never committed)

Put your Earth Engine / GCP **service-account JSON key** here, e.g. `credentials/ee-sa.json`, then set in `.env`:

    EE_SERVICE_ACCOUNT_KEY=credentials/ee-sa.json

Everything in this folder except this README and `.gitkeep` is gitignored. The key is NOT baked into Docker images;
`docker compose` mounts this folder read-only at `/credentials`. On Cloud Run use the attached service account instead (no key file).

The service account needs: `roles/serviceusage.serviceUsageConsumer`, `roles/earthengine.writer`, and (for chat/cache)
`roles/aiplatform.user`, `roles/datastore.user`, plus bucket access — `infra/setup.sh` grants these to `dnext-api`.
