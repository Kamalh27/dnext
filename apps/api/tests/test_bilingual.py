from app import i18n_th
from app.agent.events import forecast_events, scenario_events
from app.geo import dmr


def test_known_limitations_translate_and_unknown_fall_back():
    from app.geo import dmr_backend
    for s in dmr_backend.limitations({"source": "imerg"}, ["Buildings, roads and facilities are not part of the DMR layers and are not reported in this mode."]):
        assert i18n_th.limitation(s) != s, s                       # every sentence the DMR backend emits has a Thai version
    assert i18n_th.limitation("Something new") == "Something new"   # never a made-up translation
    assert "96" in i18n_th.limitation("GFS run covers only 96 h of the requested 120 h.")


def test_thai_text_never_calls_results_a_warning():
    text = " ".join(i18n_th.LIMITATIONS.values()) + i18n_th.TRIGGER_SOURCE + " ".join(i18n_th.TAMBON_COLUMNS)
    assert "เตือนภัย" not in text


def test_legends_and_layer_names_have_thai():
    for l in dmr.risk_legend() + dmr.population_legend() + dmr._legend("exposure") + dmr._legend("rain"):
        assert l["label_th"]
    for k, v in dmr.cfg()["layers"].items():
        assert v.get("name_th"), k


def _result(kind="what_if"):
    leg = dmr.risk_legend()
    tt = [{"name": "Na Thanung", "name_th": "นาทะนุง", "amphoe": "Na Muen", "amphoe_th": "นาหมื่น", "trigger_class": 5, "rain30_mm": 365,
           "risk_max": 2.0, "share_high_pct": 0, "exposure_class": 1.1, "people": 100}]
    r = {"scenario_id": "s", "kind": kind, "rainfall_mm": 250, "duration_h": 72,
         "area": {"name": "Nan", "name_th": "น่าน", "bbox": [1, 2, 3, 4], "admin_code": "TH55"},
         "hazard": {"model": "dmr", "tile_url": "", "legend": leg, "layers": [], "triggered_tambons": 74, "tambons_total": 99, "antecedent_days": 27,
                    "data_sources": ["a"], "resolution_m": 100, "date_of_data": "d", "limitations": ["Screening-level estimate of rainfall-triggered landslide risk using the DMR/ADPC method; not a forecast."]},
         "exposure": {"people": 100, "households_est": 100, "buildings": None, "road_km": None, "schools": None, "hospitals": None,
                      "top_admin_units": tt, "tambon_table": tt, "tambons_ranked": 99, "data_sources": ["b"], "limitations": [], "facilities": []}}
    if kind == "forecast":
        r["forecast"] = {"observed_rain_mm": 40.0, "forecast_rain_mm": 15.0, "horizon_days": 5, "model_run_time": "2026-10-12T18:00Z"}
    return r


def test_scenario_events_carry_parallel_thai_fields():
    ev = dict(scenario_events(_result()))
    assert ev["map_layer"]["name_th"] == "น่าน: 250 มม. / 72 ชม."
    k = ev["kpis"]
    assert k["area_name_th"] == "น่าน" and len(k["limitations_th"]) == len(k["limitations"])
    assert k["limitations_th"][0].startswith("ประมาณการคัดกรอง")
    assert k["extras"]["trigger_source_th"] and "27" in k["extras"]["rain_window_th"]
    t = ev["table"]
    assert t["rows_th"][0][0] == "นาทะนุง (นาหมื่น)" and len(t["columns_th"]) == len(t["columns"]) and len(t["rows_th"][0]) == len(t["rows"][0])
    c = ev["chart"]
    assert c["data"][0]["label_th"] == "นาทะนุง" and c["title_th"].startswith("หน่วยพื้นที่")


def test_forecast_events_have_thai_table_and_chart():
    ev = forecast_events(_result("forecast"))
    tbls = [d for n, d in ev if n == "table"]
    fc = next(t for t in tbls if t["id"].endswith("-forecast"))
    assert len(fc["columns_th"]) == len(fc["columns"]) and fc["title_th"].endswith("น่าน")
    ch = next(d for n, d in ev if n == "chart" and d["id"].endswith("-rain"))
    assert [x["label_th"] for x in ch["data"]] == ["ตรวจวัด", "พยากรณ์"]
