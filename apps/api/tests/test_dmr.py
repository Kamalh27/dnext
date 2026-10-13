import pytest

from app.agent.events import scenario_events
from app.geo import dmr, dmr_backend


def test_zscore_breaks_from_config():
    z = dmr.cfg()["susceptibility_zscore"]
    b = dmr.zscore_breaks(z["mean"], z["stddev"], z["k"])
    assert b == sorted(b) and b[0] == pytest.approx(11.59, abs=0.01) and b[3] == pytest.approx(71.17, abs=0.01)


@pytest.mark.parametrize("v,cls", [(10, 1), (11.6, 2), (31.4, 2), (31.5, 3), (60, 4), (71.2, 5), (100, 5)])
def test_susceptibility_class_matches_gt_chain(v, cls):
    z = dmr.cfg()["susceptibility_zscore"]
    assert dmr.class_from_breaks(v, dmr.zscore_breaks(z["mean"], z["stddev"], z["k"])) == cls


def test_vulnerability_and_exposure_scaling_from_national_ranges():
    vm = dmr.cfg()["scaling"]["vulnerability_multiplier"]
    em = dmr.cfg()["scaling"]["exposure_multiplier"]
    assert dmr.scaled_class(0.0233, vm) == 1 and dmr.scaled_class(0.3115, vm) == 4 and dmr.scaled_class(0.5006, vm) == 5   # national min/median/max
    assert dmr.scaled_class(0.07, em) == 1 and dmr.scaled_class(0.3144, em) == 2 and dmr.scaled_class(0.8187, em) == 5


def test_trigger_class_highest_threshold_exceeded():
    thr = [200, 250, 300, 350, 400]
    assert [dmr.trigger_class(r, thr) for r in (100, 200, 260, 310, 360, 999)] == [0, 1, 2, 3, 4, 5]


def test_trigger_class_missing_data_is_zero_not_five():
    # The reference script turns a null threshold into 0 and then classes any rain as 5; we do not.
    assert dmr.trigger_class(300, [None, None, None, None, None]) == 0
    assert dmr.trigger_class(None, [200, 250, 300, 350, 400]) == 0
    assert dmr.trigger_class(260, [200, None, 300, None, None]) == 1


def test_risk_range_and_classes():
    assert dmr.risk_value(5, 5, 5, 5) == 5.0 and dmr.risk_value(0, 5, 5, 5) == 0.0
    cuts = dmr.cfg()["risk"]["cutoffs"]
    assert [dmr.risk_class(v, cuts) for v in (0.5, 1, 2.4, 3, 4.9)] == [1, 2, 3, 4, 5]


def _row(code, mean, thr, **kw):
    return {"adm3_pcode": code, "adm3_name": f"T{code}", "adm3_name1": f"ต{code}", "adm2_pcode": "TH5501", "adm2_name": "Amp",
            "adm2_name1": "อ", "adm1_pcode": "TH55", "adm1_name": "Nan", "adm1_name1": "น่าน", "area_sqkm": 10,
            "center_lat": 1, "center_lon": 1, "thresholds": thr, "mean": mean, **kw}


def test_classify_rows_adds_scenario_rain_in_python():
    rows = [_row("A", 100, [200, 250, 300, 350, 400]), _row("B", None, [200, 250, 300, 350, 400])]
    lo = dmr.classify_rows(rows, add_mm=0)
    hi = dmr.classify_rows(rows, add_mm=160)
    assert [r["trigger_class"] for r in lo] == [0, 0]
    assert hi[0]["rain30_mm"] == 260 and hi[0]["trigger_class"] == 2
    assert hi[1]["rain30_mm"] is None and hi[1]["trigger_class"] == 0           # unknown stays unknown
    fc = dmr.classify_rows(rows, add_mm=0, add_by_code={"A": 300.0})              # forecast: per-tambon addition
    assert fc[0]["rain30_mm"] == 400 and fc[0]["trigger_class"] == 5


def test_tambon_table_ranks_people_then_peak_risk_and_keeps_none():
    rows = dmr.classify_rows([_row("A", 300, [1] * 5), _row("B", 300, [1] * 5), _row("C", 300, [1] * 5)])
    stats = {"A": {"risk": 1.0, "risk_max": 2.0, "share_high": 0.1, "expo_class": 2.0, "people_high": 1234},
             "B": {"risk": 0.5, "risk_max": 3.0, "share_high": 0.0, "expo_class": 1.0, "people_high": 0},
             "C": {}}
    t = dmr_backend.tambon_table(rows, stats, n=3)
    assert [x["admin_code"] for x in t] == ["A", "B", "C"]
    assert t[0]["people"] == 1200 and t[0]["share_high_pct"] == 10.0          # people rounded to 100
    assert t[2]["people"] is None and t[2]["risk_max"] is None                 # missing stays None, never 0


def test_min_class_maps_to_elevated_class():
    assert dmr_backend._min_high_from("High") == dmr.cfg()["risk"]["exposure_from"] == 3
    assert dmr_backend._min_high_from("Very High") == 5


def test_events_include_layers_table_and_dmr_extras():
    layers = [{"id": "x-risk", "key": "risk", "name": "Risk", "tile_url": "", "opacity": .75, "visible": True, "legend": dmr.risk_legend()},
              {"id": "x-rain", "key": "rain", "name": "Rain", "tile_url": "", "opacity": .75, "visible": False, "legend": []}]
    tt = [{"name": "T1", "amphoe": "A", "trigger_class": 5, "rain30_mm": 400, "risk_max": 2.4, "share_high_pct": 1.0, "exposure_class": 2.0, "people": 500}]
    r = {"scenario_id": "sid", "kind": "what_if", "rainfall_mm": 250, "duration_h": 72,
         "area": {"name": "Nan", "bbox": [1, 2, 3, 4], "admin_code": "TH55"},
         "hazard": {"model": "dmr", "tile_url": "", "legend": dmr.risk_legend(), "layers": layers, "triggered_tambons": 91, "tambons_total": 99,
                    "antecedent_days": 27, "data_sources": ["a"], "resolution_m": 100, "date_of_data": "2026-10-11", "limitations": ["l"]},
         "exposure": {"people": 500, "households_est": 200, "buildings": None, "road_km": None, "schools": None, "hospitals": None,
                      "top_admin_units": tt, "tambon_table": tt, "tambons_ranked": 99, "data_sources": ["b"], "limitations": [], "facilities": []}}
    ev = dict(scenario_events(r))
    assert [n for n, _ in scenario_events(r)][:3] == ["map_layer", "map_layers", "kpis"]
    assert ev["map_layers"]["layers"][0]["visible"] is True and len(ev["map_layers"]["layers"]) == 2
    assert ev["kpis"]["extras"]["triggered_tambons"] == 91 and ev["kpis"]["buildings"] is None
    assert ev["table"]["rows"][0][0] == "T1 (A)" and "Tambon" in ev["table"]["columns"][0] and len(ev["table"]["columns"]) == 6
