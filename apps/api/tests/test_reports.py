import base64
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import auth, photo, reports, usage
from app.main import app
from app.settings import settings
from tests.test_auth_limits import H, _claims

PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 64).decode()


def _analysis(**over):
    base = dict(is_slope_scene=True, scene="A road with soil across it.", report_kind="road_blocked", confidence="high", summary="Soil covers the road.",
                observations=[photo.Observation(sign="Soil on the road", evidence="Fresh soil across both lanes.", severity="high")])
    return photo.Analysis(**{**base, **over})


@pytest.fixture()
def env(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "test-project")
    monkeypatch.setenv("FIREBASE_API_KEY", "AIza-test")
    monkeypatch.setenv("FIREBASE_AUTH_DOMAIN", "test-project.firebaseapp.com")
    monkeypatch.setenv("FIREBASE_APP_ID", "1:123:web:abc")
    monkeypatch.setenv("LIMIT_BURST_PER_MIN", "50")
    monkeypatch.setenv("LIMIT_REPORT_PER_DAY", "4")
    settings.cache_clear()
    usage.reset_for_tests()
    reports.reset_for_tests()
    monkeypatch.setattr(auth, "verify_firebase_token", lambda t: (_ for _ in ()).throw(ValueError("bad")) if t in ("", "bad") else _claims(t))
    monkeypatch.setattr(reports, "data_support", lambda lat, lng: {"level": "strong", "tambon": "TH500101", "name": "Suthep", "name_th": "สุเทพ", "province": "Chiang Mai", "province_th": "เชียงใหม่"})
    monkeypatch.setattr(photo, "analyse", lambda data, mime, lang, note: _analysis())
    yield
    settings.cache_clear()
    reports.reset_for_tests()


def test_the_decision_follows_the_photo_and_the_data():
    d = reports.decide
    assert d(_analysis(), {"level": "strong"}) == ("published", "ok")
    assert d(_analysis(is_slope_scene=False), {"level": "strong"}) == ("rejected", "not_slope_scene")
    assert d(_analysis(looks_manipulated_or_unrelated=True), {"level": "strong"}) == ("rejected", "unrelated_or_manipulated")
    assert d(_analysis(report_kind="none"), {"level": "strong"}) == ("rejected", "nothing_relevant_visible")
    assert d(_analysis(confidence="low"), {"level": "strong"}) == ("review", "low_confidence")
    assert d(_analysis(confidence="medium"), {"level": "weak"}) == ("review", "data_disagrees")        # flat ground and only medium sure
    assert d(_analysis(confidence="high"), {"level": "weak"}) == ("published", "ok")                   # a clear photo wins over weak data
    assert d(_analysis(confidence="medium"), {"level": "unknown"}) == ("published", "ok")


def test_a_good_report_is_published_listed_without_personal_data_and_the_place_is_rounded(env):
    with TestClient(app) as c:
        r = c.post("/reports", json={"image_b64": PNG, "lat": 18.80612, "lng": 98.91577, "language": "en"}, headers=H("alice")).json()
        assert r["status"] == "published" and r["kind"] == "road_blocked" and r["data_support"] == "strong" and len(r["id"]) == 16
        rows = c.get("/reports").json()["reports"]
        assert len(rows) == 1 and (rows[0]["lat"], rows[0]["lng"]) == (18.806, 98.916) and rows[0]["tambon"] == "Suthep"
        assert "by" not in rows[0] and "flags" not in rows[0]
        assert c.get("/reports?west=99&south=18&east=100&north=19").json()["reports"] == []                 # outside the box


def test_rejected_reports_are_not_kept_and_review_ones_are_hidden(env, monkeypatch):
    with TestClient(app) as c:
        monkeypatch.setattr(photo, "analyse", lambda *a: _analysis(is_slope_scene=False))
        assert c.post("/reports", json={"image_b64": PNG, "lat": 18.8, "lng": 98.9}, headers=H("alice")).json()["status"] == "rejected"
        monkeypatch.setattr(photo, "analyse", lambda *a: _analysis(confidence="low"))
        r = c.post("/reports", json={"image_b64": PNG, "lat": 18.8, "lng": 98.9}, headers=H("alice")).json()
        assert r["status"] == "review" and "id" in r
        assert c.get("/reports").json()["reports"] == []


def test_the_same_event_reported_twice_nearby_is_merged(env):
    with TestClient(app) as c:
        a = c.post("/reports", json={"image_b64": PNG, "lat": 18.8061, "lng": 98.9157}, headers=H("alice")).json()
        b = c.post("/reports", json={"image_b64": PNG, "lat": 18.8063, "lng": 98.9158}, headers=H("bob")).json()
        assert b["merged"] is True and b["id"] == a["id"]
        rows = c.get("/reports").json()["reports"]
        assert len(rows) == 1 and rows[0]["confirmations"] == 1


def test_three_different_accounts_hide_a_wrong_report(env):
    with TestClient(app) as c:
        rid = c.post("/reports", json={"image_b64": PNG, "lat": 18.8, "lng": 98.9}, headers=H("alice")).json()["id"]
        for who in ("bob", "carol"):
            assert c.post(f"/reports/{rid}/flag", headers=H(who)).status_code == 200
        c.post(f"/reports/{rid}/flag", headers=H("bob"))                     # the same account again counts once
        assert len(c.get("/reports").json()["reports"]) == 1
        c.post(f"/reports/{rid}/flag", headers=H("dave"))
        assert c.get("/reports").json()["reports"] == []
        assert c.post("/reports/0000000000000000/flag", headers=H("bob")).status_code == 404
        assert c.post("/reports/zz/flag", headers=H("bob")).status_code == 422
        assert c.post(f"/reports/{rid}/flag").status_code == 401


def test_input_limits_and_old_reports(env, monkeypatch):
    with TestClient(app) as c:
        assert c.post("/reports", json={"image_b64": PNG, "lat": 40.0, "lng": 98.9}, headers=H("alice")).status_code == 422
        assert c.post("/reports", json={"image_b64": "AAAA", "lat": 18.8, "lng": 98.9}, headers=H("alice")).status_code == 422
        assert c.post("/reports", json={"image_b64": PNG, "lat": 18.8, "lng": 98.9}).status_code == 401
        reports.submit("alice", PNG, 18.8, 98.9, "en", "")
        for r in reports._mem.values():                                       # three days later a road report has expired
            r["created"] = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat(timespec="seconds")
        assert c.get("/reports").json()["reports"] == []
        for _ in range(4):
            c.post("/reports", json={"image_b64": PNG, "lat": 18.9, "lng": 98.9}, headers=H("erin"))
        assert c.post("/reports", json={"image_b64": PNG, "lat": 18.9, "lng": 98.9}, headers=H("erin")).status_code == 429
