from app import briefing, guidance
from app.agent import events
from app.geo import static_stats

ROWS = [
    {"adm3_pcode": "T1", "trigger_class": 4, "adm3_name": "Ban A", "adm3_name1": "บ้าน เอ", "adm2_name": "Mueang", "adm2_name1": "เมือง"},
    {"adm3_pcode": "T2", "trigger_class": 0, "adm3_name": "Ban B", "adm3_name1": "บ้าน บี", "adm2_name": "Mueang", "adm2_name1": "เมือง"},
]
CUT = [1, 2, 3, 4]
NAMES = ["Very low", "Low", "Moderate", "High", "Very high"]
FAC = {"tambon": {
    "T1": [["hospital", 18.1, 100.1, "A Hospital", "รพ. เอ", 100], ["school", 18.2, 100.2, "A School", "โรงเรียน เอ", 80], ["school", 18.3, 100.3, "Low", "ต่ำ", 20]],
    "T2": [["hospital", 18.4, 100.4, "Dry Hospital", "รพ. แห้ง", 125]],
}}


def test_only_facilities_that_reach_the_elevated_value_are_listed():
    r = static_stats.facilities_at_risk(FAC, ROWS, CUT, 125.0, NAMES)
    names = [f["name"] for f in r["items"]]
    assert names == ["A Hospital", "A School"]              # 4*100/125 = 3.2 and 4*80/125 = 2.56; 4*20/125 = 0.64 is below the first cutoff; T2 has no trigger
    assert (r["hospitals"], r["schools"]) == (1, 1)
    assert r["items"][0]["risk"] == 3.2 and r["items"][0]["tambon_th"] == "บ้าน เอ"
    assert (r["items"][0]["risk_class"], r["items"][0]["risk_class_name"]) == (4, "High") and r["items"][1]["risk_class_name"] == "Moderate"


def test_no_facility_file_gives_an_empty_list():
    assert static_stats.facilities_at_risk(None, ROWS, CUT) == {"items": [], "hospitals": 0, "schools": 0}


def _result():
    items = static_stats.facilities_at_risk(FAC, ROWS, CUT, 125.0, NAMES)
    tt = [{"name": "Ban A", "name_th": "บ้าน เอ", "people": 1200, "buildings": 300, "road_km": 4.0, "risk_max": 3.2}]
    return {"scenario_id": "s1", "kind": "what_if", "rainfall_mm": 200, "duration_h": 72, "area": {"name": "Nan", "name_th": "น่าน", "bbox": [0, 0, 1, 1]},
            "hazard": {"data_sources": ["a"], "limitations": ["l"], "resolution_m": 100, "date_of_data": "d", "antecedent_mm": 10, "antecedent_days": 27},
            "exposure": {"people": 1200, "households_est": 480, "buildings": 300, "road_km": 4.0, "schools": 1, "hospitals": 1, "data_sources": ["b"],
                         "limitations": [], "top_admin_units": tt, "tambon_table": tt, "facilities": items["items"],
                         "facilities_named": {"hospitals": 1, "schools": 1}}}


def test_report_lists_named_facilities_and_general_guidance():
    md = briefing.build_briefing(_result(), "en")
    assert "Hospitals and schools at risk" in md and "A Hospital" in md and "Hospital |" in md
    assert "General guidance" in md and "not an evacuation order" in md
    th = briefing.build_briefing(_result(), "th")
    assert "รพ. เอ" in th and "แนวทางทั่วไป" in th


def test_guidance_never_orders_an_evacuation_and_adds_places_section_only_when_relevant():
    g = guidance.sections(_result(), "en")
    flat = " ".join(b for _, bl in g["sections"] for b in bl).lower()
    assert "you must evacuate" not in flat and "evacuate immediately" not in flat
    assert len(g["sections"]) == 3
    quiet = _result()
    quiet["exposure"].update(people=0, facilities=[])
    assert len(guidance.sections(quiet, "en")["sections"]) == 2


def test_events_carry_markers_and_a_facility_table():
    r = _result()
    row = {"name": "Ban A", "name_th": "บ้าน เอ", "amphoe": "Mueang", "amphoe_th": "เมือง", "trigger_class": 4, "rain30_mm": 300, "risk_max": 3.2,
           "exposure_class": 3, "people": 1200, "buildings": 300, "road_km": 4.0}
    r["exposure"].update(top_admin_units=[row], tambon_table=[row], shelters=None)
    r["hazard"].update(tile_url="u", legend=[])
    ev = events.scenario_events(r)
    names = [n for n, _ in ev]
    assert "map_markers" in names and names.count("table") == 2
    marker = dict(ev)["map_markers"]["markers"][0]
    assert marker["name"] == "A Hospital" and marker["kind"] == "hospital" and marker["risk"] == 3.2 and marker["tambon_th"] == "บ้าน เอ"


def test_html_report_has_a_save_as_pdf_button_and_can_open_the_print_dialog():
    html = briefing.to_html("# T\n\n- a", "en")
    assert "Save as PDF" in html and "window.print()" in html and "addEventListener" not in html
    assert "addEventListener" in briefing.to_html("# T", "en", auto_print=True)


def _national():
    prov = {"pcode": "TH20", "name": "Chon Buri", "name_th": "ชลบุรี", "risk_class": 4, "risk_max": 3.0, "triggered": 90, "tambons": 92, "people_elevated": 3400}
    items = static_stats.facilities_at_risk(FAC, ROWS, CUT, 125.0, NAMES)["items"]
    for f in items:
        f.update(province="Chon Buri", province_th="ชลบุรี")
    return {"kind": "observed", "horizon_days": 0, "date_of_data": "2026-10-12", "tambons_total": 7425, "triggered": 2068, "provinces_triggered": 43,
            "provinces_total": 77, "people_elevated": 6000, "elevated": {"buildings": 1000, "hospitals": 0, "schools": 0, "road_km": 1.7},
            "provinces": [prov], "facilities": items, "facilities_named": {"hospitals": 1, "schools": 1}, "limitations": ["A limit."]}


def test_national_report_ranks_provinces_and_lists_facilities_in_both_languages():
    en = briefing.build_overview_report(_national(), "en")
    assert "National landslide risk overview" in en and "| 1 | Chon Buri | High | 3.0 | 90 / 92 |" in en and "A Hospital" in en and "General guidance" in en
    th = briefing.build_overview_report(_national(), "th")
    assert "ชลบุรี" in th and "สูง" in th and "แนวทางทั่วไป" in th


def test_national_report_for_a_forecast_day_names_the_model_run():
    o = _national()
    o.update(kind="forecast", horizon_days=3, model_run_time="2026-10-14T12:00Z")
    assert "Day +3 forecast" in briefing.build_overview_report(o, "en") and "2026-10-14T12:00Z" in briefing.build_overview_report(o, "en")
