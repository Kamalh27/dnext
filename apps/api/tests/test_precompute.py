import time

import pytest
from fastapi.testclient import TestClient

from app.geo import tambon_risk, obs_cache, static_stats
from app.main import app


def _row(code, t, rain=300.0):
    return {"adm3_pcode": code, "trigger_class": t, "rain30_mm": rain}


STATIC = {"tambon": {
    "A": {"area": 13.0, "ex": 0.3, "ec": 2.0, "h": {"0": [10.0, 100.0], "50": [2.0, 20.0], "125": [1.0, 5.0]}},
    "B": {"area": 5.0, "ex": 0.1, "ec": 1.0, "h": {"0": [5.0, 10.0]}},          # nothing susceptible
}}


def test_static_stats_match_hand_calculation():
    s = static_stats.tambon_stats(STATIC, [_row("A", 5), _row("B", 5)], high_value=2.0)
    a = s["rows"]["A"]
    assert a["risk_max"] == pytest.approx(5.0)                    # 5 * 125 / 125
    assert a["risk"] == pytest.approx((2 * 2.0 + 1 * 5.0) / 3)    # area-weighted over susceptible pixels (risk 2 and 5)
    assert a["share_high"] == pytest.approx(3.0 / 13.0)           # both groups are >= 2; share is of the whole tambon
    assert a["people_high"] == pytest.approx(25.0)
    assert a["expo_class"] == 2.0
    b = s["rows"]["B"]
    assert b["risk"] is None and b["risk_max"] is None and b["people_high"] == 0
    assert s["class_area_km2"]["Moderate"] == 2.0 and s["class_area_km2"]["Very high"] == 1.0   # risk 2 -> class 3, risk 5 -> class 5


def test_static_stats_untriggered_tambon_has_no_risk():
    s = static_stats.tambon_stats(STATIC, [_row("A", 0)], high_value=2.0)
    r = s["rows"]["A"]
    assert r["risk"] is None and r["people_high"] == 0 and sum(s["class_area_km2"].values()) == 0


def test_static_stats_higher_trigger_never_lowers_risk():
    lo = static_stats.tambon_stats(STATIC, [_row("A", 2)], high_value=2.0)["rows"]["A"]
    hi = static_stats.tambon_stats(STATIC, [_row("A", 5)], high_value=2.0)["rows"]["A"]
    assert hi["risk_max"] >= lo["risk_max"] and hi["people_high"] >= lo["people_high"]


def test_covers_requires_every_tambon():
    assert static_stats.covers(STATIC, [_row("A", 1), _row("B", 1)])
    assert not static_stats.covers(STATIC, [_row("A", 1), _row("Z", 1)])
    assert not static_stats.covers(None, [_row("A", 1)])


class _Area:
    level, pcode, admin_code = "province", "TH55", "TH55"


def _obs():
    now = int(time.time() * 1000)
    t = lambda pc, code, d: {"n": code, "nt": code, "a": "x", "at": "x", "ac": "TH5501", "p": "Nan", "pt": "น่าน", "pc": pc, "area": 1.0,
                             "lat": 1, "lon": 1, "thr": [100, 150, 200, 250, 300], "d": d, "f": [10.0, 25.0, 40.0]}
    return {"source": "gsmap", "newest_ms": now - 86_400_000, "days": 30, "dataset": "x", "date_of_data": "d",
            "forecast": {"model_run_time": "t", "run_ms": now - 3_600_000, "horizons": {"1": 24, "2": 48, "3": 72}},
            "tambon": {"TH550101": t("TH55", "TH550101", [1.0] * 30), "TH560101": t("TH56", "TH560101", [9.0] * 30)}}


def test_observed_rows_sum_requested_window_for_the_area_only():
    rows = obs_cache.observed_rows(_obs(), _Area(), 27)
    assert [r["adm3_pcode"] for r in rows] == ["TH550101"] and rows[0]["mean"] == 27.0
    assert obs_cache.observed_rows(_obs(), _Area(), 0)[0]["mean"] == 0.0


def test_usable_checks_source_age_and_window():
    d = _obs()
    assert obs_cache.usable(d, "gsmap", 27) and not obs_cache.usable(d, "imerg", 27) and not obs_cache.usable(d, "gsmap", 31)
    d["newest_ms"] -= 5 * 86_400_000
    assert not obs_cache.usable(d, "gsmap", 27)        # stale -> live Earth Engine
    assert not obs_cache.usable(None, "gsmap")


def test_forecast_means_use_cumulative_horizon_and_freshness():
    d = _obs()
    assert obs_cache.forecast_means(d, _Area(), 2) == {"TH550101": 25.0}
    assert obs_cache.forecast_means(d, _Area(), 7) is None            # horizon not precomputed
    d["forecast"]["run_ms"] -= 40 * 3_600_000
    assert obs_cache.forecast_means(d, _Area(), 2) is None            # run too old (> 36 h)


def test_static_layers_endpoint_in_mock_mode():
    with TestClient(app) as c:
        j = c.get("/layers/static").json()
    assert [l["key"] for l in j["layers"]] == ["susceptibility", "vulnerability", "exposure", "population"]
    assert all(l["visible"] is False and l["group"] == "static" for l in j["layers"]) and j["expires_in_s"] > 0


def test_every_layer_key_has_a_legend():
    keys = ("risk", "trigger", "rain", "susceptibility", "vulnerability", "exposure", "population")
    assert all(tambon_risk._legend(k) for k in keys)


def test_population_legend_matches_breaks_and_palette():
    c = tambon_risk.cfg()["layers"]["population"]
    leg = tambon_risk.population_legend()
    assert len(leg) == len(c["breaks"]) == len(c["palette"])
    assert leg[0]["label"].startswith("0.5–2") and leg[-1]["label"].startswith("40+")
    assert [l["color"] for l in leg] == ["#" + p for p in c["palette"]]
    assert all("people/ha" in l["label"] for l in leg)


FEATURES = {"tambon": {
    # prod -> [built_m2, hospitals, schools, road_km]
    "A": {"h": {"0": [5000.0, 1, 1, 2.0], "50": [1200.0, 0, 1, 1.5], "125": [600.0, 1, 0, 0.5]}},
    "B": {"h": {"0": [900.0, 0, 0, 0.0]}},
}}


def test_feature_counts_follow_the_same_risk_zone_rule_as_people():
    # trigger 5, high_value 2 -> prod >= 50 qualifies (5*50/125 = 2); prod 0 (not susceptible) never does
    s = static_stats.tambon_stats(STATIC, [_row("A", 5), _row("B", 5)], high_value=2.0, features=FEATURES, footprint_m2=60.0)
    a = s["rows"]["A"]
    assert a["buildings"] == pytest.approx((1200 + 600) / 60) and a["hospitals"] == 1 and a["schools"] == 1 and a["road_km"] == pytest.approx(2.0)
    assert s["rows"]["B"]["buildings"] == 0 and s["totals"]["road_km"] == pytest.approx(2.0)


def test_feature_counts_shrink_with_a_weaker_trigger_and_vanish_when_untriggered():
    # trigger 2 -> 2*p/125 >= 2 needs p >= 125: only the top bin counts
    s2 = static_stats.tambon_stats(STATIC, [_row("A", 2)], high_value=2.0, features=FEATURES)["rows"]["A"]
    assert s2["hospitals"] == 1 and s2["schools"] == 0 and s2["road_km"] == pytest.approx(0.5)
    s0 = static_stats.tambon_stats(STATIC, [_row("A", 0)], high_value=2.0, features=FEATURES)
    assert s0["rows"]["A"]["buildings"] == 0 and s0["totals"] == {"buildings": 0, "hospitals": 0, "schools": 0, "road_km": 0}


def test_without_features_the_counts_are_unavailable_not_zero():
    s = static_stats.tambon_stats(STATIC, [_row("A", 5)], high_value=2.0)
    assert "totals" not in s and "buildings" not in s["rows"]["A"]


def test_exposure_payload_reports_none_without_features_and_numbers_with_them():
    from app.geo import tambon_backend
    rows = tambon_risk.classify_rows([{"adm3_pcode": "A", "adm3_name": "T", "adm3_name1": "ต", "adm2_pcode": "x", "adm2_name": "Am", "adm2_name1": "อ",
                               "adm1_pcode": "TH55", "adm1_name": "Nan", "adm1_name1": "น", "area_sqkm": 1, "center_lat": 1, "center_lon": 1,
                               "thresholds": [1] * 5, "mean": 300.0}])
    base = {"meta": {"source": "gsmap", "dataset": "d", "date_of_data": "x"}, "fmeta": None, "rows": rows}
    no = tambon_backend._exposure_payload({**base, "stats": static_stats.tambon_stats(STATIC, rows, 2.0)}, "High")
    yes = tambon_backend._exposure_payload({**base, "stats": static_stats.tambon_stats(STATIC, rows, 2.0, features=FEATURES)}, "High")
    assert no["buildings"] is None and no["hospitals"] is None and no["road_km"] is None
    assert yes["buildings"] == 30 and yes["hospitals"] == 1 and yes["schools"] == 1 and yes["road_km"] == 2.0     # (1200+600)/60 = 30
    assert any("OpenStreetMap" in x for x in yes["limitations"]) and not any("not reported in this mode" in x for x in yes["limitations"])


def test_by_class_breakdown_adds_up_to_the_row_totals():
    rows = [_row("A", 5), _row("B", 5)]
    s = static_stats.tambon_stats(STATIC, rows, high_value=2.0, features=FEATURES, footprint_m2=60.0)
    bc = s["by_class"]
    assert [c["class"] for c in bc] == [1, 2, 3, 4, 5]
    assert sum(c["area_km2"] for c in bc) == pytest.approx(sum(s["class_area_km2"].values()), abs=0.1)
    # tambon A (trigger 5): prod 50 -> risk 2 -> class 3 (Moderate); prod 125 -> risk 5 -> class 5 (Very high)
    assert bc[2]["people"] == 20.0 and bc[4]["people"] == 5.0 and bc[2]["road_km"] == pytest.approx(1.5) and bc[4]["hospitals"] == 1
    # the elevated rows (class >= 3) are exactly the sum of those classes
    assert s["totals"]["road_km"] == pytest.approx(sum(c["road_km"] for c in bc[2:]))

