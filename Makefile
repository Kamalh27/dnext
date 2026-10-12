-include infra/config.env
.PHONY: dev test test-evals eval deploy setup
dev:    ; docker compose up --build
test:   ; cd apps/api && uv run pytest -q
test-evals: ; cd apps/api && uv run pytest ../../evals -q
eval:    ; cd apps/api && uv run adk eval app/agent ../../evals/evalset.json --config_file_path ../../evals/test_config.json
setup:  ; set -a && . infra/config.env && set +a && bash infra/setup.sh
deploy: ; gcloud builds submit --project $(PROJECT_ID) --config cloudbuild.yaml \
          --substitutions=_API_URL=$(API_URL),_MAPS_KEY=$(MAPS_KEY),_MAP_ID=$(MAP_ID)
