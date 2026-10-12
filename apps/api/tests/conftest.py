import os

os.environ.setdefault("GEO_BACKEND", "mock")
import pytest


@pytest.fixture(autouse=True)
def _local_storage(tmp_path, monkeypatch):
    from app.geo import storage
    monkeypatch.setattr(storage, "LOCAL_DIR", tmp_path / ".local_storage")
