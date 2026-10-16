"""Map tool results to typed UI events so the UI never parses prose.
Server-built text is sent in English and Thai side by side (`*_th` fields); the UI picks by language (see app/i18n_th.py)."""
from app import i18n_th as th
STATUS_LABELS = {
    "resolve_area": ("resolving_place", "Resolving place…"),
    "get_hazard_scenario": ("computing_hazard", "Computing hazard and exposure…"),
    "compare_scenarios": ("comparing", "Comparing scenarios…"),
    "explain_cell_or_village": ("explaining", "Explaining factors…"),
    "get_forecast_hazard": ("forecasting", "Fetching rainfall forecast and computing hazard…"),
    "get_exposure": ("exposure", "Computing exposure…"),
    "generate_briefing": ("briefing", "Writing briefing…"),
    "get_top_provinces": ("ranking", "Ranking provinces by risk…"),
    "get_top_tambons": ("ranking", "Ranking tambons by risk…"),
    "get_current_exposure": ("exposure", "Counting what is at risk…"),
}


FACILITY_TABLE_ROWS = 25


def status_for(tool: str) -> dict:
    stage, label = STATUS_LABELS.get(tool, (tool, f"Running {tool}…"))
    return {"stage": stage, "label": label}


def _extras(h: dict, x: dict) -> dict:
    """Tambon-mode KPIs: only present when the backend supplied them (never a made-up 0)."""
    if h.get("model") != "tambon":
        return {}
    return {"extras": {"triggered_tambons": h.get("triggered_tambons"), "tambons_total": h.get("tambons_total"),
                       "high_risk_people": x.get("people"), "trigger_source": "Tambon percentile rainfall thresholds",
                       "trigger_source_th": th.TRIGGER_SOURCE,
                       "rain_window": f"{h.get('antecedent_days', '?')} d observed + scenario",
                       "rain_window_th": th.rain_window(h.get("antecedent_days", "?"))}}


def scenario_events(r: dict) -> list[tuple[str, dict]]:
    """Events for one scenario result (shared by /chat and /scenario)."""
    h, x, a = r["hazard"], r["exposure"], r["area"]
    sid = r["scenario_id"]
    ev: list[tuple[str, dict]] = [
        ("map_layer", {
            "id": sid, "name": f"{a['name']}: {r['rainfall_mm']:.0f} mm / {r['duration_h']:.0f} h",
            "name_th": f"{a.get('name_th') or a['name']}: {r['rainfall_mm']:.0f} มม. / {r['duration_h']:.0f} ชม.",
            "tile_url": h["tile_url"], "opacity": 0.7, "bbox": a["bbox"],
            "legend": h["legend"], "scenario_id": sid,
        }),
        ("kpis", {
            "scenario_id": sid, "area_name": a["name"], "area_name_th": a.get("name_th") or a["name"], "people": x["people"],
            "households_est": x["households_est"], "buildings": x["buildings"],
            "road_km": x["road_km"], "schools": x["schools"], "hospitals": x["hospitals"],
            "data_sources": sorted(set(h["data_sources"] + x["data_sources"])),
            "resolution_m": h["resolution_m"], "date_of_data": h["date_of_data"],
            "limitations": h["limitations"] + x["limitations"],
            "limitations_th": th.limitations(h["limitations"] + x["limitations"]),
            "shelters": x.get("shelters"), "kind": r.get("kind", "what_if"),
            "rainfall_mm": r.get("rainfall_mm"), "duration_h": r.get("duration_h"), "area_code": a.get("admin_code"),
            **_extras(h, x),
            **({k: r["forecast"][k] for k in ("forecast_rain_mm", "observed_rain_mm", "horizon_days", "model_run_time")}
               if r.get("forecast") else {}),
        }),
        ("chart", {
            "id": f"{sid}-top", "title": f"Most exposed units in {a['name']} (people, est.)",
            "title_th": f"หน่วยพื้นที่ที่ได้รับผลกระทบมากที่สุดใน{a.get('name_th') or a['name']} (จำนวนคน ประมาณการ)",
            "kind": "bar", "x_label": "Unit", "y_label": "People", "x_label_th": "หน่วยพื้นที่", "y_label_th": "คน",
            "data": [{"label": u["name"], "label_th": u.get("name_th") or u["name"], "value": u["people"]}
                     for u in x["top_admin_units"] if u.get("people")],
        }),
    ]
    if h.get("layers"):
        ev.insert(1, ("map_layers", {"scenario_id": sid, "bbox": a["bbox"], "layers": h["layers"]}))
    if x.get("tambon_table"):
        ev.append(("table", {
            "id": f"{sid}-tambons", "title": f"Tambon risk and exposure: {a['name']} (top {len(x['tambon_table'])} of {x.get('tambons_ranked', '?')})",
            "title_th": f"ความเสี่ยงและการรับสัมผัสระดับตำบล: {a.get('name_th') or a['name']} ({len(x['tambon_table'])} อันดับแรกจาก {x.get('tambons_ranked', '?')})",
            "columns_th": th.TAMBON_COLUMNS,
            "rows_th": [[f"{t.get('name_th') or t['name']} ({t.get('amphoe_th') or t['amphoe']})", t["trigger_class"], t["rain30_mm"], t["risk_max"],
                         t["exposure_class"], t["people"]] for t in x["tambon_table"]],
            # 6 columns so it fits the narrow side panel; the amphoe is folded into the tambon name
            "columns": ["Tambon (amphoe)", "Trigger 0-5", "Rain 30 d (mm)", "Peak risk 0-5", "Exposure 1-5", "People in elevated risk (est.)"],
            "rows": [[f"{t['name']} ({t['amphoe']})", t["trigger_class"], t["rain30_mm"], t["risk_max"], t["exposure_class"], t["people"]]
                     for t in x["tambon_table"]],
            "scenario_id": sid,
        }))
    if x.get("facilities"):
        ev.append(("map_markers", {"id": f"{sid}-facilities", "markers": [
            {"lat": f["lat"], "lng": f["lng"], "name": f["name"], "kind": f["kind"],
             **{k: f[k] for k in ("name_th", "risk", "risk_class", "risk_class_name", "risk_class_name_th", "tambon", "tambon_th") if k in f}} for f in x["facilities"][:200]]}))
        named = [f for f in x["facilities"] if "risk" in f][:FACILITY_TABLE_ROWS]
        if named:
            counts = x.get("facilities_named") or {}
            ev.append(("table", {
                "id": f"{sid}-facilities-table",
                "title": f"Hospitals and schools at risk: {a['name']} "
                         f"({counts.get('hospitals', 0)} hospitals, {counts.get('schools', 0)} schools; top {len(named)} by risk)",
                "title_th": f"โรงพยาบาลและโรงเรียนที่มีความเสี่ยง: {a.get('name_th') or a['name']} "
                            f"(โรงพยาบาล {counts.get('hospitals', 0)} แห่ง โรงเรียน {counts.get('schools', 0)} แห่ง; {len(named)} อันดับแรกตามความเสี่ยง)",
                "columns": ["Name", "Type", "Tambon", "Risk 0-5", "Class"], "columns_th": th.FACILITY_COLUMNS,
                "rows": [[f["name"], f["kind"], f["tambon"], f["risk"], f.get("risk_class_name", "")] for f in named],
                "rows_th": [[f.get("name_th") or f["name"], th.KIND_TH.get(f["kind"], f["kind"]), f.get("tambon_th") or f["tambon"], f["risk"],
                             f.get("risk_class_name_th", "")] for f in named],
                "scenario_id": sid,
            }))
    return ev


def forecast_events(r: dict) -> list[tuple[str, dict]]:
    """scenario_events + a forecast table and rainfall chart (observed vs forecast, model run time)."""
    ev = scenario_events(r)
    f, sid = r["forecast"], r["scenario_id"]
    ev.append(("table", {
        "id": f"{sid}-forecast", "title": f"Observed + forecast rainfall: {r['area']['name']}",
        "title_th": f"ฝนตรวจวัด + พยากรณ์: {r['area'].get('name_th') or r['area']['name']}",
        "columns": ["Observed rain (mm)", "Forecast rain (mm)", "Horizon (days)", "Model run time"], "columns_th": th.OBS_FC_COLUMNS,
        "rows": [[f["observed_rain_mm"], f["forecast_rain_mm"], f["horizon_days"], f["model_run_time"]]],
        "scenario_id": sid,
    }))
    ev.append(("chart", {
        "id": f"{sid}-rain", "title": f"Rainfall (mm), model run {f['model_run_time']}", "kind": "bar",
        "title_th": f"ปริมาณฝน (มม.) รอบการคำนวณ {f['model_run_time']}",
        "x_label": "Source", "y_label": "mm", "x_label_th": "แหล่งข้อมูล", "y_label_th": "มม.",
        "data": [{"label": "Observed", "label_th": "ตรวจวัด", "value": f["observed_rain_mm"]},
                 {"label": "Forecast", "label_th": "พยากรณ์", "value": f["forecast_rain_mm"]}],
    }))
    return ev


def _when(r: dict, th_: bool = False) -> str:
    if r["horizon_days"] == 0:
        return f"ข้อมูลตรวจวัดล่าสุด {r['date_of_data']}" if th_ else f"latest observed, {r['date_of_data']}"
    return f"ตรวจวัด + พยากรณ์ {r['horizon_days']} วัน" if th_ else f"observed + {r['horizon_days']}-day forecast"


def top_provinces_events(r: dict) -> list[tuple[str, dict]]:
    rows = [[p["name"], p["risk_class_name"] if p["risk_class"] else "-", p["peak_risk"], f"{p['tambons_above_trigger']} / {p['tambons']}", p["people_in_elevated_risk_est"]]
            for p in r["top"]]
    rows_th = [[p["name_th"], p["risk_class_name_th"] if p["risk_class"] else "-", p["peak_risk"], f"{p['tambons_above_trigger']} / {p['tambons']}", p["people_in_elevated_risk_est"]]
               for p in r["top"]]
    return [("table", {
        "id": f"top-provinces-{r['horizon_days']}", "title": f"Provinces with the highest risk ({_when(r)})", "title_th": f"จังหวัดที่มีความเสี่ยงสูงสุด ({_when(r, True)})",
        "columns": ["Province", "Risk class", "Peak risk 0-5", "Tambons above trigger", "People in elevated risk (est.)"], "columns_th": th.TOP_PROVINCE_COLUMNS,
        "rows": rows, "rows_th": rows_th,
    })]


def top_tambons_events(r: dict) -> list[tuple[str, dict]]:
    a, ev = r["area"], []

    def table(key: str, tid: str, en: str, th_title: str) -> None:
        items = r[key]
        if not items:
            return
        ev.append(("table", {
            "id": f"{tid}-{r['horizon_days']}-{a['name']}", "title": f"{en}: {a['name']}", "title_th": f"{th_title}: {a.get('name_th') or a['name']}",
            "columns": ["Tambon (amphoe)", "Risk class", "Peak risk 0-5", "Trigger 0-5", "People in elevated risk (est.)"], "columns_th": th.TOP_TAMBON_COLUMNS,
            "rows": [[f"{t['tambon']} ({t['amphoe']})", t["risk_class_name"], t["peak_risk"], t["trigger_class"], t["people_in_elevated_risk_est"]] for t in items],
            "rows_th": [[f"{t['tambon_th'] or t['tambon']} ({t['amphoe_th'] or t['amphoe']})", t["risk_class_name_th"], t["peak_risk"], t["trigger_class"],
                         t["people_in_elevated_risk_est"]] for t in items],
        }))

    table("top_now", "top-tambons-now", f"Tambons with the highest risk ({_when(r)})", f"ตำบลที่มีความเสี่ยงสูงสุด ({_when(r, True)})")
    now_names = [t["tambon"] for t in r["top_now"]]
    if now_names == [t["tambon"] for t in r["top_if_rain_reaches_the_top_trigger"]]:
        return ev                       # the same list again (every top tambon is already at the top trigger): one table is enough
    table("top_if_rain_reaches_the_top_trigger", "top-tambons-ground", "Where heavy rain would hurt most (ground, not a forecast)",
          "จุดที่ฝนตกหนักจะกระทบมากที่สุด (ดูจากพื้นที่ ไม่ใช่ผลพยากรณ์)")
    return ev


def current_exposure_events(r: dict) -> list[tuple[str, dict]]:
    a = r["area"]
    where = a["name"] if a["level"] in ("national", "province") else f"{a['name']} ({a.get('amphoe') or a.get('province', '')})".replace(" ()", "")
    where_th = (a.get("name_th") or a["name"]) if a["level"] in ("national", "province") else f"{a.get('name_th') or a['name']} ({a.get('amphoe_th') or a.get('province_th') or ''})".replace(" ()", "")
    cell = lambda v: "n/a" if v is None else v
    sid = f"exposure-{a['level']}-{a['name']}-{r['horizon_days']}-{r['min_class']}"
    ev = [("table", {
        "id": sid, "title": f"At risk in {where} ({_when(r)}; {r['min_class']} or higher)", "title_th": f"ที่มีความเสี่ยงใน{where_th} ({_when(r, True)})",
        "columns": ["Area", "People (est.)", "Buildings (est.)", "Hospitals", "Schools", "Main roads (km)"], "columns_th": th.EXPOSURE_COLUMNS,
        "rows": [[where, r["people_est"], cell(r["buildings_est"]), cell(r["hospitals"]), cell(r["schools"]), cell(r["main_road_km"])]],
        "rows_th": [[where_th, r["people_est"], cell(r["buildings_est"]), cell(r["hospitals"]), cell(r["schools"]), cell(r["main_road_km"])]],
    })]
    named = r["named_facilities"]
    if named:
        ev.append(("table", {
            "id": f"{sid}-facilities", "title": f"Hospitals and schools at risk: {where}", "title_th": f"โรงพยาบาลและโรงเรียนที่มีความเสี่ยง: {where_th}",
            "columns": ["Name", "Type", "Tambon", "Risk 0-5", "Class"], "columns_th": th.FACILITY_COLUMNS,
            "rows": [[f["name"], f["kind"], f["tambon"], f["risk"], f.get("risk_class_name", "")] for f in named],
            "rows_th": [[f.get("name_th") or f["name"], th.KIND_TH.get(f["kind"], f["kind"]), f.get("tambon_th") or f["tambon"], f["risk"],
                         f.get("risk_class_name_th", "")] for f in named],
        }))
    return ev


def events_for_tool_result(tool: str, result: dict) -> list[tuple[str, dict]]:
    if result.get("status") != "ok":
        return []
    if tool == "get_current_exposure":
        return current_exposure_events(result)
    if tool == "get_top_provinces":
        return top_provinces_events(result)
    if tool == "get_top_tambons":
        return top_tambons_events(result)
    if tool == "get_hazard_scenario":
        return scenario_events(result)
    if tool == "get_forecast_hazard":
        return forecast_events(result)
    if tool == "get_exposure" and result.get("exposure", {}).get("facilities"):
        x, sid = result["exposure"], result["scenario_id"]
        return [("map_markers", {"id": f"{sid}-facilities", "markers": [
            {"lat": f["lat"], "lng": f["lng"], "name": f["name"], "kind": f["kind"]} for f in x["facilities"][:200]]})]
    if tool == "compare_scenarios":
        rows = [[f"{s['rainfall_mm']:.0f} mm", s["exposure"]["people"], s["exposure"]["households_est"],
                 s["exposure"]["buildings"], s["exposure"]["road_km"]] for s in result["scenarios"]]
        ev = [("table", {
            "id": "compare", "title": f"Scenario comparison: {result['area']['name']}",
            "title_th": f"เปรียบเทียบสถานการณ์: {result['area'].get('name_th') or result['area']['name']}",
            "columns": ["Rainfall", "People (est.)", "Households (est.)", "Buildings", "Road km"], "columns_th": th.COMPARE_COLUMNS,
            "rows": rows, "rows_th": [[f"{s['rainfall_mm']:.0f} มม.", *r[1:]] for s, r in zip(result["scenarios"], rows)],
        }), ("chart", {
            "id": "compare-chart", "title": "People exposed by rainfall", "kind": "bar",
            "title_th": "จำนวนคนที่ได้รับผลกระทบตามปริมาณฝน", "x_label": "Rainfall", "y_label": "People", "x_label_th": "ปริมาณฝน", "y_label_th": "คน",
            "data": [{"label": r[0], "label_th": r[0].replace(" mm", " มม."), "value": r[1]} for r in rows],
        })]
        if result["scenarios"]:
            ev += scenario_events(result["scenarios"][-1])[:2]
        return ev
    return []
