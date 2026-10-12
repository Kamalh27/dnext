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
    assert {n for n, _ in events_for_tool_result("get_hazard_scenario", r)} == {"map_layer", "kpis", "chart"}


def test_healthz_and_scenario_endpoint():
    with TestClient(app) as c:
        assert c.get("/healthz").json()["ok"]
        r = c.post("/scenario", json={"area": "Nan", "rainfall_mm": 250, "duration_h": 72})
        assert r.status_code == 200 and set(r.json()) == {"map_layer", "kpis", "chart"}
        assert c.post("/scenario", json={"area": "Nan", "rainfall_mm": 99999}).status_code == 422
