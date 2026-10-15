# Daily rainfall precompute (scripts/precompute_rain.py) as a Cloud Run job.
# Build from the repository root:  docker build -f infra/job.Dockerfile .
FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY apps/api/pyproject.toml apps/api/uv.lock* ./
RUN uv sync --no-dev --no-install-project
COPY apps/api/app ./app
COPY scripts ./scripts

FROM python:3.12-slim
RUN useradd -r -u 10001 app
WORKDIR /app
COPY --from=build /app /app
RUN mkdir -p /app/.local_storage && chown app /app/.local_storage
ENV PATH="/app/.venv/bin:$PATH" PYTHONPATH=/app PYTHONUNBUFFERED=1
USER app
# the bucket argument is added by the job definition (infra/cloudbuild-job.yaml)
ENTRYPOINT ["python", "scripts/daily_job.py"]
