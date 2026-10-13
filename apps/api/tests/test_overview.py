import time

import pytest
from fastapi.testclient import TestClient

from app.geo import obs_cache, overview, static_stats
from app.main import app


def _t(pc, name, d, thr=(100, 150, 200, 250, 300), f=None):
    return {"n": "x", "nt": "x", "a": "x", "at": "x", "ac": "a", "p": name, "pt": name, "pc": pc, "area": 1.0, "lat": 1, "lon": 1,
            "thr": list(thr), "d": [d] * 30, "f": f or [0.0] * 10}


@pytest.fixture()
def caches(monkeypatch):
    now = int(time.time() * 1000)
    obs = {"source": "gsmap", "dataset": "d", "newest_ms": now - 86_400_000, "days": 30, "date_of_data": "2026-10-11",
           "forecast": {"model_run_time": "t", "run_ms": now - 3_600_000, "horizons": {"5": 120}},
           "tambon": {"A1": _t("PA", "Hilly", 10.0),      # 300 mm in 30 d -> trigger 5, steep ground
                      "B1": _t("PB", "Flat", 10.0),       # also trigger 5 but nothing susceptible
                      "C1": _t("PC", "Dry", 1.0)}}        # 30 mm -> no trigger
    ss = {"tambon": {"A1": {"area": 2.0, "ex": .3, "ec": 2, "h": {"0": [1.0, 5.0], "125": [1.0, 140.0]}},
                     "B1": {"area": 2.0, "ex": .1, "ec": 1, "h": {"0": [2.0, 9.0]}},
                     "C1": {"area": 2.0, "ex": .1, "ec": 1, "h": {"125": [2.0, 9.0]}}}}
    monkeypatch.setattr(obs_cache, "load", lambda: obs)
    monkeypatch.setattr(static_stats, "load", lambda: ss)
    overview._memo.clear()
    return obs


def test_overview_ranks_by_risk_not_by_rain(caches):
    o = overview.national(0)
    assert o["tambons_total"] == 3 and o["triggered"] == 2 and o["provinces_triggered"] == 2
    assert [p["name"] for p in o["provinces"]][:2] == ["Hilly", "Flat"]          # equal rain share, but only Hilly has risk
    hilly = o["provinces"][0]
    assert hilly["risk_max"] == 5.0 and hilly["risk_class"] == 5 and hilly["people_elevated"] == 100   # 140 people, rounded to the nearest 100
    assert o["provinces"][1]["risk_class"] == 0 and [p["name"] for p in o["top"]] == ["Hilly"]


def test_overview_forecast_swaps_last_days_for_forecast(caches):
    caches["tambon"]["C1"]["f"] = [300.0] * 10                       # heavy forecast on a dry tambon
    o = overview.national(5)
    assert o["kind"] == "forecast" and o["model_run_time"] == "t"
    dry = next(p for p in o["provinces"] if p["name"] == "Dry")
    assert dry["triggered"] == 1                                       # 25 d observed (25 mm) + 300 mm forecast


def test_overview_unavailable_without_caches(monkeypatch):
    monkeypatch.setattr(obs_cache, "load", lambda: None)
    overview._memo.clear()
    with pytest.raises(overview.OverviewUnavailable):
        overview.national(0)


def test_overview_endpoint(caches):
    with TestClient(app) as c:
        r = c.get("/overview")
        assert r.status_code == 200 and r.json()["triggered"] == 2
        assert c.get("/overview?horizon_days=99").status_code == 422


def test_series_gives_one_record_per_day_with_cumulative_risk_and_daily_rain(caches):
    caches["tambon"]["C1"]["f"] = [100.0, 250.0, 300.0, 300.0, 300.0, 0, 0, 0, 0, 0]    # cumulative forecast: 100 mm on day 1, 150 on day 2
    caches["forecast"]["horizons"] = {str(h): 24 * h for h in range(1, 6)}
    s = overview.series(5)
    assert [d["h"] for d in s["days"]] == [0, 1, 2, 3, 4, 5] and s["days"][0]["date"] == "2026-10-11"
    dry = lambda h: next(p for p in s["days"][h]["provinces"] if p["pcode"] == "PC")
    assert dry(0)["rain_mm"] == 1.0 and dry(1)["rain_mm"] == 100.0 and dry(2)["rain_mm"] == 150.0 and dry(3)["rain_mm"] == 50.0
    trig = [d["totals"]["triggered"] for d in s["days"]]
    assert trig == sorted(trig)                  # synthetic data has no rain rolling out of the 30-day window, so it only grows
    assert s["days"][5]["totals"]["triggered"] == 3 and "not an official" in s["limitations"][0]


def test_series_endpoint(caches):
    caches["forecast"]["horizons"] = {str(h): 24 * h for h in range(1, 6)}
    with TestClient(app) as c:
        j = c.get("/overview/series?days=5").json()
        assert len(j["days"]) == 6 and c.get("/overview/series?days=99").status_code == 422
