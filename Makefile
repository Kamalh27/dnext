-include infra/config.env
.PHONY: dev test deploy setup
dev:    ; docker compose up --build
test:   ; cd apps/api && uv run pytest -q
setup:  ; set -a && . infra/config.env && set +a && bash infra/setup.sh
deploy: ; gcloud builds submit --project $(PROJECT_ID) --config cloudbuild.yaml \
          --substitutions=_API_URL=$(API_URL),_MAPS_KEY=$(MAPS_KEY),_MAP_ID=$(MAP_ID)
