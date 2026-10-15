import pytest
from fastapi.testclient import TestClient

from app import auth, routing, shelters, usage
from app.main import app
from app.settings import settings
from tests.test_auth_limits import H, _claims

PLACES = {"places": [
    ["school", 18.80, 98.95, "Near School", "โรงเรียนใกล้"], ["temple", 18.85, 98.95, "Wat Far", "วัดไกล"], ["hospital", 18.801, 98.951, "Near Hospital", "รพ.ใกล้"],
    ["shelter", 19.9, 99.8, "Distant Shelter", "ที่พักไกล"], ["community", 18.79, 98.94, "Hall", "ศาลา"]]}


@pytest.fixture()
def places(monkeypatch):
    shelters.reset_for_tests()
    monkeypatch.setattr(shelters, "_read", lambda: PLACES)
    yield
    shelters.reset_for_tests()


def test_nearest_places_are_sorted_and_can_be_filtered(places):
    r = shelters.nearest(18.80, 98.95, k=3)
    assert [p["name"] for p in r] == ["Near School", "Near Hospital", "Hall"] and r[0]["distance_m"] < 5
    assert [p["name"] for p in shelters.nearest(18.80, 98.95, k=5, kinds={"temple"})] == ["Wat Far"]
    assert shelters.nearest(18.80, 98.95, k=5, max_km=1) != [] and all(p["distance_m"] <= 1000 for p in shelters.nearest(18.80, 98.95, k=5, max_km=1))
    assert shelters.nearest(10.0, 100.0, k=3, max_km=20) == []                                              # nothing within reach


def test_distance_and_bearing():
    assert 110_000 < shelters.distance_m(18.0, 99.0, 19.0, 99.0) < 112_500
    assert shelters.bearing(18.0, 99.0, 19.0, 99.0) == 0 and 85 <= shelters.bearing(18.0, 99.0, 18.0, 100.0) <= 95


def test_the_shelter_endpoint_checks_its_input_and_is_public(places):
    with TestClient(app) as c:
        ok = c.get("/shelters/near?lat=18.80&lng=98.95&k=2&kind=school,hospital").json()
        assert ok["available"] and [p["name"] for p in ok["places"]] == ["Near School", "Near Hospital"] and "not a confirmed list" in ok["note"]
        assert c.get("/shelters/near?lat=40&lng=98.95").status_code == 422
        assert c.get("/shelters/near?lat=18.8&lng=98.95&k=50").status_code == 422
        assert c.get("/shelters/near?lat=18.8&lng=98.95&kind=bunker").status_code == 422


def test_polylines_decode_and_exposure_counts_only_the_stretch_near_risky_roads():
    assert routing.decode_polyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@") == [(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)]       # Google's documented example
    path = [(18.80, 98.90), (18.80, 99.00)]                                                                                      # about 10.5 km east-west
    near = [[3.2, [[98.90, 18.80], [98.92, 18.80]]]]                                                                              # about 2.1 km of risky road on the route
    far = [[3.2, [[98.90, 18.90], [98.92, 18.90]]]]
    assert 1.9 < routing.risk_exposure_km(path, near) < 2.4 and routing.risk_exposure_km(path, far) == 0 and routing.risk_exposure_km(path, []) == 0


def _raw(*routes):
    import itertools
    def enc(vals):
        out = ""
        prev = 0
        for v in vals:
            d = round(v * 1e5) - prev
            prev += d
            d = ~(d << 1) if d < 0 else d << 1
            while d >= 0x20:
                out += chr((0x20 | (d & 0x1F)) + 63)
                d >>= 5
            out += chr(d + 63)
        return out
    def line(pts):
        a = b = 0
        res = ""
        for lat, lng in pts:
            res += enc([lat - a / 1e5 if False else lat])[:0]
        return res
    # simple encoder for [(lat, lng)] using Google's algorithm
    def encode(pts):
        res, plat, plng = "", 0, 0
        for lat, lng in pts:
            for cur, prev in ((round(lat * 1e5), plat), (round(lng * 1e5), plng)):
                d = cur - prev
                d = ~(d << 1) if d < 0 else d << 1
                while d >= 0x20:
                    res += chr((0x20 | (d & 0x1F)) + 63)
                    d >>= 5
                res += chr(d + 63)
            plat, plng = round(lat * 1e5), round(lng * 1e5)
        return res
    return {"routes": [{"distanceMeters": dist, "duration": f"{secs}s", "polyline": {"encodedPolyline": encode(pts)}} for dist, secs, pts in routes]}


def test_routes_are_ranked_by_risky_exposure_then_time(monkeypatch):
    routing.reset_for_tests()
    fast_risky = (10_000, 600, [(18.80, 98.90), (18.80, 99.00)])
    slow_safe = (13_000, 900, [(18.78, 98.90), (18.78, 99.00)])
    monkeypatch.setattr(routing, "_call_google", lambda o, d, m, alt: _raw(fast_risky, slow_safe))
    risky = [[3.2, [[98.90, 18.80], [98.95, 18.80]]]]
    out = routing.routes((18.8, 98.9), (18.8, 99.0), "DRIVE", risky)
    assert [r["recommended"] for r in out] == [False, True] and out[0]["flagged"] and not out[1]["flagged"] and out[0]["risk_km"] > 4 and out[1]["risk_km"] == 0
    plain = routing.routes((18.8, 98.9), (18.8, 99.0), "DRIVE", None)                      # served from the cache; no result on screen: not scored
    assert [r["risk_km"] for r in plain] == [None, None] and not any(r["flagged"] for r in plain)


def test_a_failing_routes_api_becomes_a_clear_error_and_the_cache_saves_calls(monkeypatch):
    routing.reset_for_tests()
    calls = []
    monkeypatch.setattr(routing, "_call_google", lambda *a: calls.append(1) or _raw((1000, 60, [(18.8, 98.9), (18.8, 98.91)])))
    routing.routes((18.8, 98.9), (18.8, 98.91)); routing.routes((18.80001, 98.90001), (18.8, 98.91))
    assert len(calls) == 1                                                                   # same place to four decimals: cached
    routing.reset_for_tests()
    monkeypatch.setattr(routing, "_call_google", lambda *a: (_ for _ in ()).throw(RuntimeError("403")))
    with pytest.raises(routing.RouteUnavailable):
        routing.routes((18.8, 98.9), (18.8, 98.91))
    routing.reset_for_tests()
    monkeypatch.setattr(settings(), "route_daily_cap", 0)
    with pytest.raises(routing.RouteUnavailable):
        routing.routes((18.8, 98.9), (18.8, 98.92))


@pytest.fixture()
def secured(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "test-project")
    monkeypatch.setenv("FIREBASE_API_KEY", "AIza-test")
    monkeypatch.setenv("FIREBASE_AUTH_DOMAIN", "test-project.firebaseapp.com")
    monkeypatch.setenv("FIREBASE_APP_ID", "1:123:web:abc")
    monkeypatch.setenv("LIMIT_ROUTE_PER_DAY", "5")
    monkeypatch.setenv("LIMIT_BURST_PER_MIN", "50")
    settings.cache_clear()
    usage.reset_for_tests()
    routing.reset_for_tests()
    monkeypatch.setattr(auth, "verify_firebase_token", lambda t: (_ for _ in ()).throw(ValueError("bad")) if t in ("", "bad") else _claims(t))
    yield
    settings.cache_clear()
    usage.reset_for_tests()


def test_the_route_endpoint_needs_sign_in_validates_points_and_has_its_own_daily_limit(secured, monkeypatch):
    monkeypatch.setattr(routing, "_call_google", lambda *a: _raw((5000, 300, [(18.80, 98.90), (18.80, 98.95)])))
    body = {"origin": {"lat": 18.8, "lng": 98.9}, "destination": {"lat": 18.8, "lng": 98.95}}
    with TestClient(app) as c:
        assert c.post("/route", json=body).status_code == 401
        assert c.post("/route", json={**body, "destination": {"lat": 35, "lng": 139}}, headers=H("alice")).status_code == 422
        assert c.post("/route", json={**body, "destination": {"lat": 19.9, "lng": 100.9}}, headers=H("alice")).status_code == 422          # more than 150 km
        assert c.post("/route", json={**body, "mode": "FLY"}, headers=H("alice")).status_code == 422
        r1 = c.post("/route", json=body, headers=H("alice"))
        assert r1.status_code == 200 and r1.json()["routes"][0]["distance_m"] == 5000 and r1.json()["scored"] is False
        assert c.post("/route", json=body, headers=H("alice")).status_code == 200            # three refused inputs and two routes: the daily budget of 5 is used up
        r3 = c.post("/route", json=body, headers=H("alice"))
        assert r3.status_code == 429 and r3.json()["detail"]["kind"] == "route"
