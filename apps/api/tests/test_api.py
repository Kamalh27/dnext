from fastapi.testclient import TestClient

from app.agent.events import events_for_tool_result
from app.geo import service
from app.geo.areas import AreaError, resolve
from app.main import app
import pytest


def test_resolve_th_and_en():
    assert resolve("nan").admin_code == "TH55"
    assert resolve("เชียงใหม่").name == "Chiang Mai"


def test_resolve_outside_thailand():
    with pytest.raises(AreaError):
        resolve("Tokyo")


def test_scenario_cached_and_stable():
    a = resolve("Nan")
    r1, r2 = service.run_scenario(a, 250, 72), service.run_scenario(a, 250, 72)
    assert r2["cached"] and r1["scenario_id"] == r2["scenario_id"]
    assert r1["exposure"]["households_est"] <= r1["exposure"]["people"]


def test_event_mapping_types():
    r = {"status": "ok", **service.run_scenario(resolve("Nan"), 200, 72)}
    assert {n for n, _ in events_for_tool_result("get_hazard_scenario", r)} == {"map_layer", "kpis", "chart", "map_markers"}


def test_healthz_and_scenario_endpoint():
    with TestClient(app) as c:
        assert c.get("/healthz").json()["ok"]
        r = c.post("/scenario", json={"area": "Nan", "rainfall_mm": 250, "duration_h": 72})
        assert r.status_code == 200 and set(r.json()) == {"map_layer", "kpis", "chart", "map_markers", "tables"}
        assert c.post("/scenario", json={"area": "Nan", "rainfall_mm": 99999}).status_code == 422


def test_forecast_endpoint_and_request_id():
    with TestClient(app) as c:
        r = c.post("/forecast", json={"area": "Nan", "horizon_days": 5})
        assert r.status_code == 200 and "table" in r.json() and r.headers["x-request-id"]
        assert c.post("/forecast", json={"area": "Tokyo"}).status_code == 422
        assert c.get("/healthz", headers={"x-request-id": "abc"}).headers["x-request-id"] == "abc"


def test_briefing_endpoint():
    with TestClient(app) as c:
        sid = c.post("/scenario", json={"area": "Nan", "rainfall_mm": 220})
        assert sid.status_code == 200
        sid = sid.json()["kpis"]["scenario_id"]
        md = c.get(f"/briefing/{sid}")
        assert md.status_code == 200 and md.text.startswith("# ") and "markdown" in md.headers["content-type"]
        th = c.get(f"/briefing/{sid}?language=th")
        assert "สมมติฐาน" in th.text
        h = c.get(f"/briefing/{sid}?format=html")
        assert "<table>" in h.text and "text/html" in h.headers["content-type"]
        assert c.get("/briefing/unknown").status_code == 404
        assert c.get(f"/briefing/{sid}?language=fr").status_code == 422


def test_explain_with_scenario_id():
    with TestClient(app) as c:
        sid = c.post("/scenario", json={"area": "Nan", "rainfall_mm": 220}).json()["kpis"]["scenario_id"]
        assert c.get(f"/explain?lat=18.8&lng=100.8&scenario_id={sid}").json()["scenario"]["scenario_id"] == sid


def test_timeout_middleware(monkeypatch):
    import asyncio
    from app.settings import settings
    monkeypatch.setattr(settings(), "request_timeout_s", 0.05)

    @app.get("/_slow")
    async def slow():
        await asyncio.sleep(1)
    with TestClient(app) as c:
        assert c.get("/_slow").status_code == 504
