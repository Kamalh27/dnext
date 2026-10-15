import base64
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app import alerts, auth, history, photo, usage
from app.main import app
from app.settings import settings
from tests.test_auth_limits import H, _claims


def _series(date="2026-10-15", run="2026-10-15T00:00Z", classes=((0, 0, 0), (0, 0, 0))):
    """Two provinces, three days: classes[i][h] is the risk class of province i on day h."""
    days = []
    for h in range(3):
        days.append({"h": h, "provinces": [
            {"pcode": "TH50", "name": "Chiang Mai", "name_th": "เชียงใหม่", "risk_class": classes[0][h], "risk_max": float(classes[0][h]), "triggered": 5, "tambons": 204, "people_elevated": 100, "rain_mm": 3.0},
            {"pcode": "TH55", "name": "Nan", "name_th": "น่าน", "risk_class": classes[1][h], "risk_max": float(classes[1][h]), "triggered": 2, "tambons": 99, "people_elevated": 0, "rain_mm": None}]})
    return {"date_of_data": date, "model_run_time": run, "days": days}


@pytest.fixture()
def fresh(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "test-project")
    monkeypatch.setenv("FIREBASE_API_KEY", "AIza-test")
    monkeypatch.setenv("FIREBASE_AUTH_DOMAIN", "test-project.firebaseapp.com")
    monkeypatch.setenv("FIREBASE_APP_ID", "1:123:web:abc")
    monkeypatch.setenv("LIMIT_BURST_PER_MIN", "50")
    settings.cache_clear()
    usage.reset_for_tests()
    alerts.reset_for_tests()
    history.reset_for_tests()
    monkeypatch.setattr(auth, "verify_firebase_token", lambda t: (_ for _ in ()).throw(ValueError("bad")) if t in ("", "bad") else _claims(t))
    yield
    settings.cache_clear()
    alerts.reset_for_tests()


# ---------------- what changed between two runs
def test_the_first_run_only_records_the_state():
    assert alerts.detect(_series(classes=((4, 4, 4), (0, 0, 0))), None, 3) == []


def test_a_province_that_rises_to_the_threshold_raises_one_event_with_its_first_day():
    before = {"classes": {"TH50": 1, "TH55": 3}}
    ev = alerts.detect(_series(classes=((1, 1, 4), (3, 3, 3))), before, 3)
    assert [(e["province_code"], e["class"], e["horizon"], e["date"]) for e in ev] == [("TH50", 4, 2, "2026-10-17")]      # Nan was already 3: no event


def test_nothing_is_reported_below_the_threshold_or_when_the_class_falls():
    assert alerts.detect(_series(classes=((2, 2, 2), (0, 0, 0))), {"classes": {"TH50": 0}}, 3) == []
    assert alerts.detect(_series(classes=((3, 3, 3), (0, 0, 0))), {"classes": {"TH50": 5}}, 3) == []


def test_messages_are_plain_and_in_the_watcher_language():
    ev = {"province": "Chiang Mai", "province_th": "เชียงใหม่", "class": 3, "horizon": 0}
    assert alerts.message(ev, "en")[0] == "Chiang Mai: landslide risk reaches Moderate"
    assert "not a warning" in alerts.message(ev, "en")[1]
    assert "เชียงใหม่" in alerts.message(ev, "th")[0] and "ปานกลาง" in alerts.message(ev, "th")[0]


# ---------------- the whole path: watch list -> new data -> notification
def test_watchers_of_a_province_that_gets_riskier_are_notified_once(fresh):
    with TestClient(app) as c:
        assert c.put("/watchlist", json={"provinces": ["th50", "TH50", "TH55"], "min_class": 3, "lang": "en"}, headers=H("alice")).json()["provinces"] == ["TH50", "TH55"]
        c.put("/watchlist", json={"provinces": ["TH55"], "min_class": 3}, headers=H("bob"))
        assert alerts.process_new_data(_series(classes=((1, 1, 1), (1, 1, 1))))["notified"] == 0           # first run: state only
        r = alerts.process_new_data(_series(date="2026-10-16", run="2026-10-16T00:00Z", classes=((1, 4, 4), (1, 1, 1))))
        assert r == {"skipped": False, "notified": 1}
        a = c.get("/alerts", headers=H("alice")).json()
        assert a["unread"] == 1 and a["items"][0]["province_code"] == "TH50" and a["items"][0]["title"].startswith("Chiang Mai")
        assert c.get("/alerts", headers=H("bob")).json()["items"] == []
        c.post("/alerts/read", headers=H("alice"))
        assert c.get("/alerts", headers=H("alice")).json()["unread"] == 0
        assert alerts.process_new_data(_series(date="2026-10-16", run="2026-10-16T00:00Z", classes=((1, 4, 4), (1, 1, 1))))["skipped"] is True      # same run again


def test_a_higher_threshold_means_fewer_alerts(fresh):
    with TestClient(app) as c:
        c.put("/watchlist", json={"provinces": ["TH50"], "min_class": 5}, headers=H("alice"))
        alerts.process_new_data(_series(classes=((1, 1, 1), (0, 0, 0))))
        alerts.process_new_data(_series(date="2026-10-16", run="r2", classes=((1, 4, 4), (0, 0, 0))))
        assert c.get("/alerts", headers=H("alice")).json()["items"] == []


def test_watch_list_input_is_checked_and_needs_sign_in(fresh):
    with TestClient(app) as c:
        assert c.get("/watchlist").status_code == 401
        assert c.put("/watchlist", json={"provinces": ["Nan"]}, headers=H("alice")).status_code == 422
        assert c.put("/watchlist", json={"provinces": [f"TH{i:02d}" for i in range(11)]}, headers=H("alice")).status_code == 422
        assert c.put("/watchlist", json={"provinces": ["TH50"], "min_class": 1}, headers=H("alice")).status_code == 422


def test_the_push_endpoint_accepts_only_a_verified_google_token(fresh, monkeypatch):
    with TestClient(app) as c:
        assert c.post("/internal/new-data", json={}).status_code == 403                                  # no token
        assert c.post("/internal/new-data", json={}, headers={"Authorization": "Bearer nope"}).status_code == 403
        monkeypatch.setattr(alerts, "verify_push", lambda h: h == "Bearer good")
        from app.geo import overview
        monkeypatch.setattr(overview, "latest_series", lambda d=5: _series(classes=((0, 0, 0), (0, 0, 0))))
        r = c.post("/internal/new-data", json={}, headers={"Authorization": "Bearer good"})
        assert r.status_code == 200 and r.json()["skipped"] is False       # it processed the series, not just acknowledged the message


def test_push_messages_decode():
    body = {"message": {"data": base64.b64encode(b'{"date_of_data": "2026-10-15"}').decode()}}
    assert alerts.decode_push(body) == {"date_of_data": "2026-10-15"} and alerts.decode_push({"message": {"data": "!!"}}) == {}


# ---------------- history rows
def test_the_history_rows_cover_every_province_and_day_with_forecast_dates():
    rows = history.province_rows(_series(), datetime(2026, 10, 15, 6, 30, tzinfo=timezone.utc))
    assert len(rows) == 6 and rows[0]["date"] == "2026-10-15" and rows[-1]["date"] == "2026-10-17" and rows[-1]["horizon"] == 2
    assert rows[0]["province_code"] == "TH50" and rows[0]["run_time"].startswith("2026-10-15T06:30")


def test_trend_without_bigquery_says_so(monkeypatch):
    history.reset_for_tests()
    monkeypatch.setattr(history, "_client", lambda: None)
    with TestClient(app) as c:
        assert c.get("/trend/TH50").json() == {"pcode": "TH50", "available": False, "days": []}
        assert c.get("/trend/Nan").status_code == 422 and c.get("/trend/TH50?days=1").status_code == 422


# ---------------- photo check
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


def test_only_real_photos_are_accepted():
    assert photo.decode(base64.b64encode(PNG).decode())[1] == "image/png"
    for bad in ("not base64!!", base64.b64encode(b"GIF89a....").decode(), base64.b64encode(b"x" * (photo.MAX_IMAGE_BYTES + 1)).decode()):
        with pytest.raises(ValueError):
            photo.decode(bad)


def test_the_photo_check_returns_the_analysis_with_the_risk_of_the_result_on_screen(fresh, monkeypatch):
    from app.geo import service
    monkeypatch.setattr(photo, "analyse", lambda data, mime, lang, note: photo.Analysis(
        is_slope_scene=True, scene="A cut slope above a road.", report_kind="slope_damage", confidence="medium",
        observations=[photo.Observation(sign="Fresh cracks", evidence="Cracks run along the top of the cut.", severity="moderate")], summary="Cracks are visible."))
    monkeypatch.setattr(service, "get_cached", lambda sid: {"area": {"name": "Nan", "name_th": "น่าน"}, "exposure": {"tambon_risks": [{"risk": 2.4}, {"risk": 1.0}]}} if sid == "s1" else None)
    with TestClient(app) as c:
        ok = c.post("/photo-check", json={"image_b64": base64.b64encode(PNG).decode(), "scenario_id": "s1", "language": "th"}, headers=H("alice")).json()
        assert ok["analysis"]["observations"][0]["sign"] == "Fresh cracks" and ok["context"] == {"area": "Nan", "area_th": "น่าน", "peak_risk": 2.4, "scenario_id": "s1"}
        assert "ไม่ใช่การตรวจสอบ" in ok["disclaimer"]
        assert c.post("/photo-check", json={"image_b64": "AAAA"}, headers=H("alice")).status_code == 422
        assert c.post("/photo-check", json={"image_b64": base64.b64encode(PNG).decode()}).status_code == 401
