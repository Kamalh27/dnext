-include infra/config.env
.PHONY: dev test test-evals eval deploy setup
dev:    ; docker compose up --build
test:   ; cd apps/api && uv run pytest -q
test-evals: ; cd apps/api && uv run pytest ../../evals -q
eval:    ; cd apps/api && uv run adk eval app/agent ../../evals/evalset.json --config_file_path ../../evals/test_config.json
setup:  ; set -a && . infra/config.env && set +a && bash infra/setup.sh
deploy: ; bash infra/deploy.sh
