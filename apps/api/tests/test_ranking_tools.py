"""The ranking tools behind "which provinces / tambons are at highest risk": the answers come from the daily files, the classes are named by the tool."""
import time

import pytest

from app.agent import tools
from app.agent.events import events_for_tool_result, status_for
from app.geo import obs_cache, overview, static_stats


def _t(code, pc, p, ac, a, d, thr=(100, 150, 200, 250, 300), f=None):
    return {"n": f"T{code}", "nt": f"ต{code}", "a": a, "at": f"อ{a}", "ac": ac, "p": p, "pt": f"จ{p}", "pc": pc, "area": 1.0, "lat": 1, "lon": 1,
            "thr": list(thr), "d": [d] * 30, "f": f or [0.0] * 10}


@pytest.fixture()
def caches(monkeypatch):
    now = int(time.time() * 1000)
    obs = {"source": "gsmap", "dataset": "d", "newest_ms": now - 86_400_000, "days": 30, "date_of_data": "2026-10-11",
           "forecast": {"model_run_time": "t", "run_ms": now - 3_600_000, "horizons": {"5": 120}},
           "tambon": {"A1": _t("A1", "TH50", "Hilly", "TH5001", "North", 10.0),     # triggered, steep, 140 people
                      "A2": _t("A2", "TH50", "Hilly", "TH5001", "North", 1.0),      # dry today, steepest ground
                      "A3": _t("A3", "TH50", "Hilly", "TH5002", "South", 1.0),
                      "B1": _t("B1", "TH51", "Flat", "TH5101", "Mid", 10.0)}}       # triggered but nothing susceptible
    ss = {"tambon": {"A1": {"area": 2.0, "ex": .3, "ec": 2, "h": {"0": [1.0, 5.0], "100": [1.0, 140.0]}},
                     "A2": {"area": 2.0, "ex": .3, "ec": 2, "h": {"125": [1.0, 900.0]}},
                     "A3": {"area": 2.0, "ex": .3, "ec": 2, "h": {"50": [1.0, 20.0]}},
                     "B1": {"area": 2.0, "ex": .1, "ec": 1, "h": {"0": [2.0, 9.0]}}}}
    monkeypatch.setattr(obs_cache, "load", lambda: obs)
    monkeypatch.setattr(static_stats, "load", lambda: ss)
    monkeypatch.setattr(overview, "_series_file", lambda *a, **k: None)
    overview._memo.clear()
    return obs


def test_top_provinces_names_the_class_and_counts(caches):
    r = tools.get_top_provinces(0, 5)
    assert r["status"] == "ok" and r["provinces_total"] == 2 and r["provinces_with_a_tambon_above_trigger"] == 1
    first = r["top"][0]
    assert first["name"] == "Hilly" and first["risk_class_name"] == "Very high" and first["peak_risk"] == 4.0
    assert first["tambons_above_trigger"] == 1 and first["tambons"] == 3
    flat = r["top"][1]
    assert flat["risk_class"] == 0 and "No tambon above its trigger" in flat["risk_class_name"]      # rain without landslide-prone ground is not risk


def test_top_provinces_rejects_a_bad_horizon(caches):
    assert tools.get_top_provinces(9)["status"] == "error"


def test_top_tambons_separates_today_from_the_ground(caches):
    r = tools.get_top_tambons("TH50", 0, 5)
    assert r["status"] == "ok" and r["tambons_total"] == 3 and r["tambons_above_trigger"] == 1
    assert [t["tambon"] for t in r["top_now"]] == ["TA1"]
    ground = [t["tambon"] for t in r["top_if_rain_reaches_the_top_trigger"]]
    assert ground[0] == "TA2"                                         # the steepest ground leads even though it is dry today
    assert r["top_if_rain_reaches_the_top_trigger"][0]["risk_class_name"] == "Very high"


def test_top_tambons_is_empty_when_nothing_is_triggered(caches):
    caches["tambon"]["A1"]["d"] = [1.0] * 30
    r = tools.get_top_tambons("TH50", 0, 5)
    assert r["top_now"] == [] and r["top_if_rain_reaches_the_top_trigger"]


def test_ranking_results_become_tables_in_both_languages(caches):
    ev = events_for_tool_result("get_top_provinces", tools.get_top_provinces(0, 5))
    kind, t = ev[0]
    assert kind == "table" and t["columns"][0] == "Province" and t["rows"][0][0] == "Hilly" and t["rows_th"][0][0] == "จHilly" and t["title_th"]
    ev2 = events_for_tool_result("get_top_tambons", tools.get_top_tambons("TH50", 0, 5))
    assert [e[0] for e in ev2] == ["table", "table"] and "not a forecast" in ev2[1][1]["title"]
    assert status_for("get_top_provinces")["stage"] == "ranking"


def test_the_prompt_sends_ranking_questions_to_the_ranking_tools():
    from app.agent.prompts import SYSTEM
    assert "get_top_provinces" in SYSTEM and "get_top_tambons" in SYSTEM and "never ask the user to name a province" in SYSTEM


def test_the_second_table_is_left_out_when_it_repeats_the_first(caches):
    for k in ("A2", "A3"):
        caches["tambon"][k]["d"] = [10.0] * 30                        # now every susceptible tambon is above its trigger: same list both ways
    r = tools.get_top_tambons("TH50", 0, 5)
    assert [t["tambon"] for t in r["top_now"]] == [t["tambon"] for t in r["top_if_rain_reaches_the_top_trigger"]]
    assert len(events_for_tool_result("get_top_tambons", r)) == 1
