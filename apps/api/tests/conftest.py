import os

os.environ.setdefault("GEO_BACKEND", "mock")
# Tests must not depend on a developer's local .env (real sign-in settings would gate the endpoints): environment variables win over .env.
for _k in ("AUTH_REQUIRED", "FIREBASE_API_KEY", "FIREBASE_AUTH_DOMAIN", "FIREBASE_APP_ID"):
    os.environ[_k] = "false" if _k == "AUTH_REQUIRED" else ""
import pytest


@pytest.fixture(autouse=True)
def _local_storage(tmp_path, monkeypatch):
    from app.geo import storage
    monkeypatch.setattr(storage, "LOCAL_DIR", tmp_path / ".local_storage")
