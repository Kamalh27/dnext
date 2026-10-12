import json

import pytest

from app import settings as s


def _with_key(monkeypatch, value):
    monkeypatch.setenv("EE_SERVICE_ACCOUNT_KEY", value)
    s.settings.cache_clear()


def test_no_key_configured(monkeypatch):
    _with_key(monkeypatch, "")
    assert s.service_account_key_path() is None


def test_absolute_key_path(monkeypatch, tmp_path):
    k = tmp_path / "sa.json"
    k.write_text(json.dumps({"project_id": "p"}))
    _with_key(monkeypatch, str(k))
    assert s.service_account_key_path() == k


def test_relative_key_resolves_against_repo_root(monkeypatch):
    _with_key(monkeypatch, "credentials/does-not-exist.json")
    with pytest.raises(FileNotFoundError, match="credentials/does-not-exist.json"):
        s.service_account_key_path()


def test_ee_project_falls_back_to_key_project(monkeypatch, tmp_path):
    k = tmp_path / "sa.json"
    k.write_text(json.dumps({"project_id": "from-key"}))
    _with_key(monkeypatch, str(k))
    monkeypatch.setenv("EE_PROJECT", "")
    s.settings.cache_clear()
    from app.geo import ee_init
    monkeypatch.setattr(ee_init, "_initialised", False)
    seen = {}
    monkeypatch.setattr("google.oauth2.service_account.Credentials.from_service_account_file", lambda *a, **kw: "creds")
    monkeypatch.setattr(ee_init.ee, "Initialize", lambda creds, project: seen.update(creds=creds, project=project))
    ee_init.init()
    assert seen == {"creds": "creds", "project": "from-key"}
