set dotenv-load := true
set shell := ["bash", "-cu"]

default:
    @just --list

# --- run the UI locally (mock geo backend, no cloud needed except /chat) ---

# Install deps for api + web, create env files if missing
setup:
    cd apps/api && uv sync
    cd apps/web && pnpm install
    [ -f .env ] || cp .env.example .env
    [ -f apps/web/.env.local ] || cp apps/web/.env.example apps/web/.env.local
    @echo "Edit apps/web/.env.local: set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY and NEXT_PUBLIC_GOOGLE_MAP_ID"

# API on :8080 (mock backend by default)
api:
    cd apps/api && GEO_BACKEND=${GEO_BACKEND:-mock} uv run uvicorn app.main:app --reload --port 8080

# Web on :3000
web:
    cd apps/web && pnpm dev

# API + web together (Ctrl-C stops both)
dev:
    #!/usr/bin/env bash
    trap 'kill 0' EXIT
    just api &
    just web &
    wait

# Open the UI
open:
    open http://localhost:3000

# Quick check of the mock API without the UI or Gemini
curl-scenario area="Nan" mm="250" hours="72":
    curl -s -X POST localhost:8080/scenario -H 'content-type: application/json' \
      -d '{"area":"{{area}}","rainfall_mm":{{mm}},"duration_h":{{hours}}}' | python3 -m json.tool | head -60

# --- quality ---
test:
    cd apps/api && uv run pytest -q

web-check:
    cd apps/web && pnpm exec tsc --noEmit && pnpm lint

# Needs EE_PROJECT + credentials
test-ee:
    cd apps/api && uv run pytest -q -m integration

# Needs Vertex credentials
eval:
    cd apps/api && uv run adk eval app/agent ../../evals/evalset.json --config_file_path ../../evals/test_config.json

test-evals:
    cd apps/api && uv run pytest ../../evals -q

# --- docker / deploy (needs infra/config.env) ---
docker:
    docker compose up --build

setup-gcp:
    set -a && . infra/config.env && set +a && bash infra/setup.sh

deploy:
    bash infra/deploy.sh

deploy-job:
    bash infra/deploy-job.sh

deploy-api:
    bash infra/deploy.sh --api-only

deploy-web:
    bash infra/deploy.sh --web-only

smoke url:
    python3 infra/smoke_test.py {{url}}
