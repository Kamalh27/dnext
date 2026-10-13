import time

import jwt
import pytest
from fastapi.testclient import TestClient

from app import auth, usage
from app.main import app
from app.settings import settings


@pytest.fixture()
def secured(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "test-client.apps.googleusercontent.com")
    monkeypatch.setenv("SESSION_SECRET", "unit-test-secret-unit-test-secret-1234")
    monkeypatch.setenv("LIMIT_RUN_PER_DAY", "3")
    monkeypatch.setenv("LIMIT_CHAT_PER_DAY", "2")
    monkeypatch.setenv("LIMIT_BURST_PER_MIN", "50")
    settings.cache_clear()
    usage.reset_for_tests()
    # Google's verification is network + signature work; replace it with a stub keyed on the credential string
    monkeypatch.setattr(auth, "verify_google_id_token", lambda cred: {"sub": cred, "email": f"{cred}@example.org", "name": cred.title(), "picture": ""})
    yield
    settings.cache_clear()
    usage.reset_for_tests()


def _login(c, who="alice"):
    r = c.post("/auth/google", json={"credential": who})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


RUN = {"area": "Nan", "rainfall_mm": 200, "duration_h": 72}


def test_nothing_is_gated_by_default():
    with TestClient(app) as c:
        assert c.post("/scenario", json=RUN).status_code == 200
        assert c.get("/auth/config").json()["auth_required"] is False


def test_gated_endpoints_need_a_session_but_public_ones_stay_open(secured):
    with TestClient(app) as c:
        r = c.post("/scenario", json=RUN)
        assert r.status_code == 401 and r.json()["detail"]["code"] == "auth_required" and r.headers["www-authenticate"] == "Bearer"
        assert c.post("/forecast", json={"area": "Nan"}).status_code == 401
        assert c.post("/chat", json={"message": "hi"}).status_code == 401
        assert c.get("/explain?lat=18.8&lng=100.7").status_code == 401
        for public in ("/healthz", "/auth/config", "/layers/static"):
            assert c.get(public).status_code == 200, public
        cfg = c.get("/auth/config").json()
        assert cfg["auth_required"] and cfg["google_client_id"].startswith("test-client") and cfg["limits"]["chat"] == 2


def test_login_issues_a_session_and_me_reports_usage(secured):
    with TestClient(app) as c:
        h = _login(c)
        me = c.get("/me", headers=h).json()
        assert me["user"]["email"] == "alice@example.org" and me["usage"]["run"] == {"used": 0, "limit": 3}
        assert c.post("/scenario", json=RUN, headers=h).status_code == 200
        assert c.get("/me", headers=h).json()["usage"]["run"]["used"] == 1
        assert c.get("/me").status_code == 401


def test_invalid_google_token_and_bad_sessions_are_rejected(secured, monkeypatch):
    def boom(_):
        raise ValueError("bad token")
    monkeypatch.setattr(auth, "verify_google_id_token", boom)
    with TestClient(app) as c:
        r = c.post("/auth/google", json={"credential": "x"})
        assert r.status_code == 401 and r.json()["detail"]["code"] == "invalid_google_token"
        s = settings()
        forged = jwt.encode({"iss": "dnext-landslidewatch", "sub": "u", "exp": int(time.time()) + 600}, "another-secret-another-secret-12345", algorithm="HS256")
        expired = jwt.encode({"iss": "dnext-landslidewatch", "sub": "u", "exp": int(time.time()) - 5}, s.session_secret, algorithm="HS256")
        wrong_iss = jwt.encode({"iss": "someone-else", "sub": "u", "exp": int(time.time()) + 600}, s.session_secret, algorithm="HS256")
        for bad in (forged, expired, wrong_iss, "garbage"):
            assert c.post("/scenario", json=RUN, headers={"Authorization": f"Bearer {bad}"}).status_code == 401


def test_daily_run_limit_is_per_account_and_returns_429_with_retry_after(secured):
    with TestClient(app) as c:
        a, b = _login(c, "alice"), _login(c, "bob")
        for _ in range(3):
            assert c.post("/scenario", json=RUN, headers=a).status_code == 200
        r = c.post("/scenario", json=RUN, headers=a)
        d = r.json()["detail"]
        assert r.status_code == 429 and d["code"] == "daily_limit" and d["limit"] == 3 and d["used"] == 3
        assert int(r.headers["retry-after"]) == d["retry_after_s"] > 0 and "reset_at" in d
        assert c.post("/forecast", json={"area": "Nan"}, headers=a).status_code == 429        # scenario + forecast share the 'run' budget
        assert c.post("/scenario", json=RUN, headers=b).status_code == 200                    # another account is unaffected
        assert c.get("/me", headers=a).json()["usage"]["run"] == {"used": 3, "limit": 3}


def test_chat_budget_is_separate_and_light_endpoints_do_not_spend_it(secured):
    class Fake:
        async def run_async(self, **kw):
            return
            yield  # pragma: no cover

    with TestClient(app) as c:
        app.state.runner = Fake()
        h = _login(c)
        assert c.post("/chat", json={"message": "a"}, headers=h).status_code == 200
        assert c.post("/chat", json={"message": "b"}, headers=h).status_code == 200
        assert c.post("/chat", json={"message": "c"}, headers=h).status_code == 429
        assert c.post("/scenario", json=RUN, headers=h).status_code == 200                    # runs still available
        for _ in range(5):
            assert c.get("/explain?lat=18.8&lng=100.7", headers=h).status_code == 200         # 'light': signed in + burst only
        assert c.get("/me", headers=h).json()["usage"]["chat"]["used"] == 2


def test_burst_limit_per_minute(secured, monkeypatch):
    monkeypatch.setenv("LIMIT_BURST_PER_MIN", "2")
    settings.cache_clear()
    with TestClient(app) as c:
        h = _login(c)
        assert [c.get("/explain?lat=18.8&lng=100.7", headers=h).status_code for _ in range(3)] == [200, 200, 429]
        r = c.get("/explain?lat=18.8&lng=100.7", headers=h)
        assert r.json()["detail"]["code"] == "burst_limit" and int(r.headers["retry-after"]) <= 61


def test_account_id_is_a_one_way_hash_not_the_google_subject():
    uid = auth.account_id("1234567890")
    assert uid != "1234567890" and len(uid) == 24 and uid == auth.account_id("1234567890") and uid != auth.account_id("1234567891")
