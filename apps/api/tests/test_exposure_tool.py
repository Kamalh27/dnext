"""'How many buildings, hospitals and schools are at risk in <place>': place lookup, the numbers per level, and the follow-up-friendly behaviour."""
import time

import pytest

from app.agent import tools
from app.agent.events import events_for_tool_result
from app.geo import obs_cache, overview, places, static_stats


def _t(code, pc, p, ac, a, name, d, nt=None):
    return {"n": name, "nt": nt or f"ต{name}", "a": a, "at": f"อ{a}", "ac": ac, "p": p, "pt": f"จ{p}", "pc": pc, "area": 1.0, "lat": 1, "lon": 1,
            "thr": [100, 150, 200, 250, 300], "d": [d] * 30, "f": [0.0] * 10}


@pytest.fixture()
def world(monkeypatch):
    now = int(time.time() * 1000)
    obs = {"source": "gsmap", "dataset": "d", "newest_ms": now - 86_400_000, "days": 30, "date_of_data": "2026-10-11", "forecast": {"model_run_time": "t", "run_ms": now - 3_600_000, "horizons": {"5": 120}},
           "tambon": {"A1": _t("A1", "TH50", "Hilly", "TH5001", "North", "Suthep", 10.0),
                      "A2": _t("A2", "TH50", "Hilly", "TH5001", "North", "Phra", 1.0),
                      "A3": _t("A3", "TH50", "Hilly", "TH5002", "South", "Bang Phra", 10.0),
                      "B1": _t("B1", "TH20", "Coast", "TH2001", "Port", "Bang Phra", 10.0)}}
    ss = {"tambon": {c: {"area": 2.0, "ex": .3, "ec": 2, "h": {"125": [1.0, 140.0]}} for c in ("A1", "A2", "A3", "B1")}}
    feats = {"tambon": {"A1": {"h": {"125": [600.0, 1, 2, 3.5]}}, "A3": {"h": {"125": [300.0, 0, 1, 0.5]}}, "B1": {"h": {"125": [60.0, 0, 0, 0.0]}}}}
    fac = {"tambon": {"A1": [("hospital", 1.0, 1.0, "Hill Hospital", "รพ.", 125), ("school", 1.0, 1.0, "Hill School", "รร.", 125)]}}
    monkeypatch.setattr(obs_cache, "load", lambda: obs)
    monkeypatch.setattr(static_stats, "load", lambda: ss)
    monkeypatch.setattr(static_stats, "load_features", lambda: feats)
    monkeypatch.setattr(static_stats, "load_facilities", lambda: fac)
    monkeypatch.setattr(overview, "_series_file", lambda *a, **k: None)
    places._index.clear()
    overview._memo.clear()
    return obs


def test_places_find_tambons_districts_and_repeated_names(world):
    assert places.find("Suthep")["level"] == "tambon" and places.find("Suthep")["code"] == "A1"
    assert places.find("North")["level"] == "amphoe" and places.find("อNorth")["code"] == "TH5001"
    assert places.find("ต.Suthep")["code"] == "A1"                        # Thai prefix
    r = places.find("Bang Phra, Coast")
    assert r["code"] == "B1"
    with pytest.raises(places.PlaceError) as e:
        places.find("Bang Phra")                                         # two tambons share the name: never guess
    assert len(e.value.candidates) == 2 and "Hilly" in e.value.candidates[0] + e.value.candidates[1]
    with pytest.raises(places.PlaceError):
        places.find("Nowhere")


def test_exposure_numbers_for_country_province_and_tambon(world):
    nat = tools.get_current_exposure("Thailand")
    assert nat["status"] == "ok" and nat["area"]["level"] == "national" and nat["tambons_total"] == 4
    prov = tools.get_current_exposure("Hilly")
    assert prov["status"] == "ok" and prov["area"]["level"] == "province" and prov["tambons_total"] == 3
    assert prov["hospitals"] == 1 and prov["schools"] == 3 and prov["named_hospitals_at_risk"] == 1
    assert nat["buildings_est"] >= prov["buildings_est"]                  # the country holds the province
    one = tools.get_current_exposure("Suthep, Hilly")
    assert one["area"]["level"] == "tambon" and one["tambons_total"] == 1 and one["hospitals"] == 1 and one["main_road_km"] == 3.5
    assert [f["name"] for f in one["named_facilities"]] == ["Hill Hospital", "Hill School"]


def test_a_dry_tambon_has_nothing_at_risk_and_says_zero(world):
    r = tools.get_current_exposure("Phra, Hilly")
    assert r["status"] == "ok" and r["tambons_above_trigger"] == 0 and r["people_est"] == 0 and r["hospitals"] == 0


def test_a_repeated_name_returns_candidates_instead_of_a_guess(world):
    r = tools.get_current_exposure("Bang Phra")
    assert r["status"] == "error" and len(r["place_candidates"]) == 2


def test_min_class_and_bad_input(world):
    assert tools.get_current_exposure("Thailand", min_class="Very high")["status"] == "ok"
    assert tools.get_current_exposure("Thailand", horizon_days=9)["status"] == "error"
    assert tools.get_current_exposure("Thailand", min_class="Extreme")["status"] == "error"


def test_exposure_becomes_a_table_in_both_languages(world):
    ev = events_for_tool_result("get_current_exposure", tools.get_current_exposure("Suthep, Hilly"))
    assert [e[0] for e in ev] == ["table", "table"]
    summary = ev[0][1]
    assert summary["columns"][0] == "Area" and summary["rows"][0][3] == 1 and summary["title_th"] and summary["rows_th"][0][0].startswith("ต")


def test_top_tambons_accepts_a_district(world):
    r = tools.get_top_tambons("North")
    assert r["status"] == "ok" and r["area"]["level"] == "amphoe" and r["tambons_total"] == 2


def test_prompt_covers_exposure_and_follow_ups():
    from app.agent.prompts import SYSTEM
    assert "get_current_exposure" in SYSTEM and "Follow-ups" in SYSTEM and "ONE short question" in SYSTEM
