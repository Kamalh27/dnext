from app.agent import tools
from app.agent.events import events_for_tool_result, status_for


def names(tool, res):
    return [n for n, _ in events_for_tool_result(tool, res)]


def test_all_tools_return_status_never_raise():
    outs = [
        tools.resolve_area("Tokyo"), tools.resolve_area(""),
        tools.get_hazard_scenario("Nan", 5000), tools.get_hazard_scenario("Atlantis", 100),
        tools.get_forecast_hazard("Tokyo"), tools.get_forecast_hazard("Nan", 99),
        tools.get_exposure("Nowhere"), tools.get_exposure("Nan", min_class="Bogus"),
        tools.compare_scenarios("Nan", []), tools.explain_cell_or_village(35.6, 139.7),
        tools.generate_briefing("nope"),
    ]
    assert all(o["status"] == "error" and o["message"] for o in outs)


def test_forecast_tool_and_events():
    r = tools.get_forecast_hazard("Nan")
    assert r["status"] == "ok"
    ev = events_for_tool_result("get_forecast_hazard", r)
    assert {"map_layer", "kpis", "chart", "map_markers", "table"} <= {n for n, _ in ev}
    k = dict(ev)["kpis"]
    assert k["model_run_time"] and k["kind"] == "forecast"
    assert status_for("get_forecast_hazard")["stage"] == "forecasting"


def test_exposure_uses_cached_scenario():
    s = tools.get_hazard_scenario("Nan", 180, 48)
    e = tools.get_exposure("Nan", s["scenario_id"])
    assert e["exposure"]["people"] == s["exposure"]["people"] and "note" not in e
    d = tools.get_exposure("Nan")
    assert "250" in d["note"]
    m = tools.get_exposure("Nan", s["scenario_id"], "Moderate")
    assert m["exposure"]["min_class"] == "Moderate"
    assert names("get_exposure", e) == ["map_markers"]


def test_briefing_tool():
    s = tools.get_hazard_scenario("Nan", 200)
    b = tools.generate_briefing(s["scenario_id"], "th")
    assert b["status"] == "ok" and b["language"] == "th" and "สมมติฐาน" in b["markdown"]


def test_markers_in_scenario_events():
    s = tools.get_hazard_scenario("Nan", 300)
    mk = dict(events_for_tool_result("get_hazard_scenario", s))["map_markers"]
    assert mk["markers"] and {"lat", "lng", "name", "kind"} == set(mk["markers"][0])


def test_agent_builds_with_all_tools():
    from app.agent.agent import root_agent
    assert len(root_agent.tools) == 7


def test_prompt_forbids_warning_wording_and_long_answers():
    from app.agent.prompts import SYSTEM
    assert "never \"warning thresholds\"" in SYSTEM and "เตือนภัย" in SYSTEM          # the rule names the forbidden Thai term
    assert "at most 4 short bullet points" in SYSTEM and "Do NOT repeat the tambon table" in SYSTEM
