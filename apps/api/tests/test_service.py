import pytest

from app.geo import cache, mock, service
from app.geo.areas import resolve


def test_mock_matches_real_backend_shapes():
    a = resolve("Nan")
    h, x = mock.hazard_scenario(a, 250, 72), mock.exposure(a, 250, 72)
    assert h["antecedent_mm"] > 0 and h["antecedent_days"] == 15
    for k in ("building_area_m2", "road_km_by_class", "shelters", "facilities", "top_admin_units"):
        assert k in x
    assert len(x["facilities"]) <= 200
    w, s, e, n = a.bbox
    assert all(w <= f["lng"] <= e and s <= f["lat"] <= n and f["kind"] for f in x["facilities"])
    assert {"name", "name_th", "admin_code", "people", "buildings", "road_km"} <= set(x["top_admin_units"][0])
    f = mock.forecast_hazard(a, 3)
    assert {"forecast_rain_mm", "observed_rain_mm", "horizon_days", "model_run_time"} <= set(f)
    assert "MOCK" in " ".join(x["limitations"])


def test_forecast_cached_and_keyed_by_horizon():
    a = resolve("Chiang Mai")
    r1, r2, r3 = service.run_forecast(a, 5), service.run_forecast(a, 5), service.run_forecast(a, 3)
    assert r1["kind"] == "forecast" and r2["cached"] and r1["scenario_id"] == r2["scenario_id"]
    assert r3["scenario_id"] != r1["scenario_id"]
    assert r1["forecast"]["horizon_days"] == 5
    with pytest.raises(ValueError):
        service.run_forecast(a, 99)


def test_scenario_min_class_changes_id_only_when_non_default():
    a = resolve("Nan")
    assert service.scenario_id(a, 100, 72) == service.scenario_id(a, 100, 72, "High")
    assert service.scenario_id(a, 100, 72, "Moderate") != service.scenario_id(a, 100, 72)


def test_explain_with_scenario():
    r = service.run_scenario(resolve("Nan"), 200, 72)
    e = service.explain_point(18.8, 100.8, r["scenario_id"])
    assert e["scenario"]["rainfall_mm"] == 200 and "factors" in e
    assert "scenario" not in service.explain_point(18.8, 100.8, "nope")


def test_validation_errors():
    with pytest.raises(ValueError):
        service.run_scenario(resolve("Nan"), 5000, 72)
