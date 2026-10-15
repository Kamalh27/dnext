import pytest
from fastapi.testclient import TestClient

from app import auth, chats, usage
from app.main import app
from app.settings import settings
from tests.test_auth_limits import H, _claims

THREAD = {"title": "", "lang": "en", "area": "TH55", "messages": [
    {"role": "user", "text": "What if Nan gets 250 mm?"},
    {"role": "activity", "text": "Ran 250 mm over 72 h in Nan", "run": {"kind": "what_if", "area": "TH55", "area_name": "Nan", "rainfall_mm": 250, "duration_h": 72}},
    {"role": "assistant", "text": "About 100 people are in the elevated zone."}]}


@pytest.fixture()
def secured(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "test-project")
    monkeypatch.setenv("FIREBASE_API_KEY", "AIza-test")
    monkeypatch.setenv("FIREBASE_AUTH_DOMAIN", "test-project.firebaseapp.com")
    monkeypatch.setenv("FIREBASE_APP_ID", "1:123:web:abc")
    settings.cache_clear()
    usage.reset_for_tests()
    chats.reset_memory()
    monkeypatch.setattr(auth, "verify_firebase_token", lambda t: (_ for _ in ()).throw(ValueError("bad")) if t in ("", "bad") else _claims(t))
    yield
    settings.cache_clear()
    chats.reset_memory()


def test_history_is_unavailable_when_sign_in_is_off():
    with TestClient(app) as c:
        r = c.get("/chats")
        assert r.status_code == 404 and r.json()["detail"]["code"] == "history_unavailable"


def test_saved_chats_need_a_signed_in_account(secured):
    with TestClient(app) as c:
        assert c.get("/chats").status_code == 401
        assert c.put("/chats/abcdefgh12", json=THREAD).status_code == 401
        assert c.get("/chats", headers=H("bad")).status_code == 401


def test_a_chat_is_saved_listed_read_and_deleted(secured):
    with TestClient(app) as c:
        r = c.put("/chats/abcdefgh12", json=THREAD, headers=H("alice"))
        assert r.status_code == 200 and r.json()["title"] == "What if Nan gets 250 mm?" and r.json()["count"] == 3
        rows = c.get("/chats", headers=H("alice")).json()["threads"]
        assert [x["id"] for x in rows] == ["abcdefgh12"]
        d = c.get("/chats/abcdefgh12", headers=H("alice")).json()
        assert d["messages"][1]["run"]["rainfall_mm"] == 250 and d["area"] == "TH55"
        assert c.delete("/chats/abcdefgh12", headers=H("alice")).json() == {"ok": True}
        assert c.get("/chats/abcdefgh12", headers=H("alice")).status_code == 404


def test_accounts_never_see_each_others_chats(secured):
    with TestClient(app) as c:
        c.put("/chats/abcdefgh12", json=THREAD, headers=H("alice"))
        assert c.get("/chats", headers=H("bob")).json()["threads"] == []
        assert c.get("/chats/abcdefgh12", headers=H("bob")).status_code == 404
        c.delete("/chats/abcdefgh12", headers=H("bob"))
        assert c.get("/chats/abcdefgh12", headers=H("alice")).status_code == 200


def test_bad_input_is_rejected(secured):
    with TestClient(app) as c:
        assert c.put("/chats/x", json=THREAD, headers=H("alice")).status_code == 422                       # id too short
        assert c.put("/chats/abcdefgh12", json={**THREAD, "lang": "fr"}, headers=H("alice")).status_code == 422
        too_many = {**THREAD, "messages": [{"role": "user", "text": "hi"}] * (chats.MAX_MESSAGES + 1)}
        assert c.put("/chats/abcdefgh12", json=too_many, headers=H("alice")).status_code == 422
        assert c.put("/chats/abcdefgh12", json={**THREAD, "messages": [{"role": "system", "text": "x"}]}, headers=H("alice")).status_code == 422


def test_a_big_conversation_fits_but_other_requests_keep_the_small_cap(secured):
    big = {**THREAD, "messages": [{"role": "assistant", "text": "x" * 5000}] * 100}          # about 500 KB
    with TestClient(app) as c:
        assert c.put("/chats/abcdefgh12", json=big, headers=H("alice")).status_code == 200
        assert c.post("/scenario", content=b"{" + b" " * 20_000 + b"}", headers={**H("alice"), "content-type": "application/json"}).status_code == 413


def test_the_browser_may_save_and_delete_chats_from_another_origin():
    with TestClient(app) as c:
        for method in ("PUT", "DELETE"):
            r = c.options("/chats/abcdefgh12", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": method, "Access-Control-Request-Headers": "authorization,content-type"})
            assert r.status_code == 200 and method in r.headers["access-control-allow-methods"]
