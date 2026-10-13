import pytest
from fastapi.testclient import TestClient

from app import auth, usage
from app.main import app
from app.settings import settings


def _claims(name: str, **over) -> dict:
    return {"sub": name, "user_id": name, "email": f"{name}@example.org", "name": name.title(), "picture": "", "email_verified": True,
            "firebase": {"sign_in_provider": "google.com"}, **over}


@pytest.fixture()
def secured(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "test-project")
    monkeypatch.setenv("FIREBASE_API_KEY", "AIza-test")
    monkeypatch.setenv("FIREBASE_AUTH_DOMAIN", "test-project.firebaseapp.com")
    monkeypatch.setenv("FIREBASE_APP_ID", "1:123:web:abc")
    monkeypatch.setenv("LIMIT_RUN_PER_DAY", "3")
    monkeypatch.setenv("LIMIT_CHAT_PER_DAY", "2")
    monkeypatch.setenv("LIMIT_BURST_PER_MIN", "50")
    settings.cache_clear()
    usage.reset_for_tests()

    def fake_verify(token: str) -> dict:                 # Firebase's signature check is network + crypto work; stub it, keyed on the token text
        if token in ("", "bad", "expired"):
            raise ValueError("invalid token")
        return _claims(token)

    monkeypatch.setattr(auth, "verify_firebase_token", fake_verify)
    yield
    settings.cache_clear()
    usage.reset_for_tests()


def H(who="alice"):
    return {"Authorization": f"Bearer {who}"}


RUN = {"area": "Nan", "rainfall_mm": 200, "duration_h": 72}


def test_nothing_is_gated_by_default():
    with TestClient(app) as c:
        assert c.post("/scenario", json=RUN).status_code == 200
        cfg = c.get("/auth/config").json()
        assert cfg["auth_required"] is False and cfg["firebase"] is None


def test_gated_endpoints_need_a_token_but_public_ones_stay_open(secured):
    with TestClient(app) as c:
        r = c.post("/scenario", json=RUN)
        assert r.status_code == 401 and r.json()["detail"]["code"] == "auth_required" and r.headers["www-authenticate"] == "Bearer"
        assert c.post("/forecast", json={"area": "Nan"}).status_code == 401
        assert c.post("/chat", json={"message": "hi"}).status_code == 401
        assert c.get("/explain?lat=18.8&lng=100.7").status_code == 401
        for public in ("/healthz", "/auth/config", "/layers/static"):
            assert c.get(public).status_code == 200, public
        cfg = c.get("/auth/config").json()
        assert cfg["auth_required"] and cfg["limits"]["chat"] == 2
        assert cfg["firebase"] == {"apiKey": "AIza-test", "authDomain": "test-project.firebaseapp.com", "projectId": "test-project", "appId": "1:123:web:abc"}


def test_me_reports_the_user_and_usage_and_runs_count(secured):
    with TestClient(app) as c:
        me = c.get("/me", headers=H()).json()
        assert me["user"]["email"] == "alice@example.org" and me["usage"]["run"] == {"used": 0, "limit": 3}
        assert c.post("/scenario", json=RUN, headers=H()).status_code == 200
        assert c.get("/me", headers=H()).json()["usage"]["run"]["used"] == 1
        assert c.get("/me").status_code == 401


def test_invalid_or_expired_tokens_are_rejected(secured):
    with TestClient(app) as c:
        for bad in ("bad", "expired"):
            r = c.post("/scenario", json=RUN, headers={"Authorization": f"Bearer {bad}"})
            assert r.status_code == 401 and r.json()["detail"]["code"] == "auth_required"
        assert c.post("/scenario", json=RUN, headers={"Authorization": "Basic abc"}).status_code == 401


def test_daily_run_limit_is_per_account_and_returns_429_with_retry_after(secured):
    with TestClient(app) as c:
        for _ in range(3):
            assert c.post("/scenario", json=RUN, headers=H("alice")).status_code == 200
        r = c.post("/scenario", json=RUN, headers=H("alice"))
        d = r.json()["detail"]
        assert r.status_code == 429 and d["code"] == "daily_limit" and d["limit"] == 3 and d["used"] == 3
        assert int(r.headers["retry-after"]) == d["retry_after_s"] > 0 and "reset_at" in d
        assert c.post("/forecast", json={"area": "Nan"}, headers=H("alice")).status_code == 429     # scenario + forecast share the 'run' budget
        assert c.post("/scenario", json=RUN, headers=H("bob")).status_code == 200                  # another account is unaffected
        assert c.get("/me", headers=H("alice")).json()["usage"]["run"] == {"used": 3, "limit": 3}


def test_chat_budget_is_separate_and_light_endpoints_do_not_spend_it(secured):
    class Fake:
        async def run_async(self, **kw):
            return
            yield  # pragma: no cover

    with TestClient(app) as c:
        app.state.runner = Fake()
        assert c.post("/chat", json={"message": "a"}, headers=H()).status_code == 200
        assert c.post("/chat", json={"message": "b"}, headers=H()).status_code == 200
        assert c.post("/chat", json={"message": "c"}, headers=H()).status_code == 429
        assert c.post("/scenario", json=RUN, headers=H()).status_code == 200
        for _ in range(5):
            assert c.get("/explain?lat=18.8&lng=100.7", headers=H()).status_code == 200
        assert c.get("/me", headers=H()).json()["usage"]["chat"]["used"] == 2


def test_burst_limit_per_minute(secured, monkeypatch):
    monkeypatch.setenv("LIMIT_BURST_PER_MIN", "2")
    settings.cache_clear()
    with TestClient(app) as c:
        assert [c.get("/explain?lat=18.8&lng=100.7", headers=H()).status_code for _ in range(3)] == [200, 200, 429]
        r = c.get("/explain?lat=18.8&lng=100.7", headers=H())
        assert r.json()["detail"]["code"] == "burst_limit" and int(r.headers["retry-after"]) <= 61


def test_account_id_is_a_one_way_hash_not_the_firebase_uid():
    uid = auth.account_id("firebase-uid-123")
    assert uid != "firebase-uid-123" and len(uid) == 24 and uid == auth.account_id("firebase-uid-123") and uid != auth.account_id("firebase-uid-124")
    assert auth.user_from_claims(_claims("carol")).uid == auth.account_id("carol")


# ---- the real verification wrapper (Google's signature check is stubbed; our extra rules are not) ----
@pytest.fixture()
def real_verify(monkeypatch):
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "test-project")
    settings.cache_clear()
    yield
    settings.cache_clear()


def _stub_google(monkeypatch, claims):
    import google.oauth2.id_token as g
    seen = {}

    def fake(token, request, audience=None, **kw):
        seen["audience"] = audience
        if claims is None:
            raise ValueError("Token expired")
        return claims
    monkeypatch.setattr(g, "verify_firebase_token", fake)
    return seen


def test_verification_uses_our_project_as_audience_and_accepts_google_users(real_verify, monkeypatch):
    seen = _stub_google(monkeypatch, _claims("dave"))
    assert auth.verify_firebase_token("t")["email"] == "dave@example.org" and seen["audience"] == "test-project"


@pytest.mark.parametrize("over,why", [({"email_verified": False}, "unverified email"), ({"firebase": {"sign_in_provider": "password"}}, "other provider"),
                                      ({"firebase": {}}, "no provider")])
def test_verification_rejects_unverified_email_and_non_google_providers(real_verify, monkeypatch, over, why):
    _stub_google(monkeypatch, _claims("eve", **over))
    with pytest.raises(ValueError):
        auth.verify_firebase_token("t")


def test_verification_failures_become_401_not_500(real_verify, monkeypatch, secured):
    monkeypatch.undo()                      # use the real wrapper with a failing Google check
    monkeypatch.setenv("AUTH_REQUIRED", "true"); monkeypatch.setenv("FIREBASE_PROJECT_ID", "test-project"); settings.cache_clear()
    _stub_google(monkeypatch, None)
    with TestClient(app) as c:
        assert c.post("/scenario", json=RUN, headers=H("whatever")).status_code == 401


def test_certificate_downloads_are_cached(monkeypatch):
    import google.auth.transport.requests as g
    calls = []

    class Resp:
        status = 200

    def fake_call(self, url, method="GET", body=None, headers=None, timeout=10, **kw):
        calls.append(url)
        return Resp()
    monkeypatch.setattr(g.Request, "__call__", fake_call)
    auth._certs.clear()
    r = auth._cached_request()
    for _ in range(3):
        r("https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com")
    assert len(calls) == 1
