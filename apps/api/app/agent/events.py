"""Map tool results to typed UI events so the UI never parses prose."""
STATUS_LABELS = {
    "resolve_area": ("resolving_place", "Resolving place…"),
    "get_hazard_scenario": ("computing_hazard", "Computing hazard and exposure…"),
    "compare_scenarios": ("comparing", "Comparing scenarios…"),
    "explain_cell_or_village": ("explaining", "Explaining factors…"),
    "get_forecast_hazard": ("forecasting", "Fetching rainfall forecast and computing hazard…"),
    "get_exposure": ("exposure", "Computing exposure…"),
    "generate_briefing": ("briefing", "Writing briefing…"),
}


def status_for(tool: str) -> dict:
    stage, label = STATUS_LABELS.get(tool, (tool, f"Running {tool}…"))
    return {"stage": stage, "label": label}


def _extras(h: dict, x: dict) -> dict:
    """DMR-mode KPIs: only present when the backend supplied them (never a made-up 0)."""
    if h.get("model") != "dmr":
        return {}
    return {"extras": {"triggered_tambons": h.get("triggered_tambons"), "tambons_total": h.get("tambons_total"),
                       "high_risk_people": x.get("people"), "trigger_source": "DMR tambon percentile thresholds",
                       "rain_window": f"{h.get('antecedent_days', '?')} d observed + scenario"}}


def scenario_events(r: dict) -> list[tuple[str, dict]]:
    """Events for one scenario result (shared by /chat and /scenario)."""
    h, x, a = r["hazard"], r["exposure"], r["area"]
    sid = r["scenario_id"]
    ev: list[tuple[str, dict]] = [
        ("map_layer", {
            "id": sid, "name": f"{a['name']}: {r['rainfall_mm']:.0f} mm / {r['duration_h']:.0f} h",
            "tile_url": h["tile_url"], "opacity": 0.7, "bbox": a["bbox"],
            "legend": h["legend"], "scenario_id": sid,
        }),
        ("kpis", {
            "scenario_id": sid, "area_name": a["name"], "people": x["people"],
            "households_est": x["households_est"], "buildings": x["buildings"],
            "road_km": x["road_km"], "schools": x["schools"], "hospitals": x["hospitals"],
            "data_sources": sorted(set(h["data_sources"] + x["data_sources"])),
            "resolution_m": h["resolution_m"], "date_of_data": h["date_of_data"],
            "limitations": h["limitations"] + x["limitations"],
            "shelters": x.get("shelters"), "kind": r.get("kind", "what_if"),
            "rainfall_mm": r.get("rainfall_mm"), "duration_h": r.get("duration_h"), "area_code": a.get("admin_code"),
            **_extras(h, x),
            **({k: r["forecast"][k] for k in ("forecast_rain_mm", "observed_rain_mm", "horizon_days", "model_run_time")}
               if r.get("forecast") else {}),
        }),
        ("chart", {
            "id": f"{sid}-top", "title": f"Most exposed units in {a['name']} (people, est.)",
            "kind": "bar", "x_label": "Unit", "y_label": "People",
            "data": [{"label": u["name"], "value": u["people"]} for u in x["top_admin_units"] if u.get("people")],
        }),
    ]
    if h.get("layers"):
        ev.insert(1, ("map_layers", {"scenario_id": sid, "bbox": a["bbox"], "layers": h["layers"]}))
    if x.get("tambon_table"):
        ev.append(("table", {
            "id": f"{sid}-tambons", "title": f"Tambon risk and exposure: {a['name']} (top {len(x['tambon_table'])} of {x.get('tambons_ranked', '?')})",
            # 6 columns so it fits the narrow side panel; the amphoe is folded into the tambon name
            "columns": ["Tambon (amphoe)", "Trigger 0-5", "Rain 30 d (mm)", "Peak risk 0-5", "Exposure 1-5", "People in elevated risk (est.)"],
            "rows": [[f"{t['name']} ({t['amphoe']})", t["trigger_class"], t["rain30_mm"], t["risk_max"], t["exposure_class"], t["people"]]
                     for t in x["tambon_table"]],
            "scenario_id": sid,
        }))
    if x.get("facilities"):
        ev.append(("map_markers", {"id": f"{sid}-facilities", "markers": [
            {"lat": f["lat"], "lng": f["lng"], "name": f["name"], "kind": f["kind"]} for f in x["facilities"][:200]]}))
    return ev


def forecast_events(r: dict) -> list[tuple[str, dict]]:
    """scenario_events + a forecast table and rainfall chart (observed vs forecast, model run time)."""
    ev = scenario_events(r)
    f, sid = r["forecast"], r["scenario_id"]
    ev.append(("table", {
        "id": f"{sid}-forecast", "title": f"Observed + forecast rainfall: {r['area']['name']}",
        "columns": ["Observed rain (mm)", "Forecast rain (mm)", "Horizon (days)", "Model run time"],
        "rows": [[f["observed_rain_mm"], f["forecast_rain_mm"], f["horizon_days"], f["model_run_time"]]],
        "scenario_id": sid,
    }))
    ev.append(("chart", {
        "id": f"{sid}-rain", "title": f"Rainfall (mm), model run {f['model_run_time']}", "kind": "bar",
        "x_label": "Source", "y_label": "mm",
        "data": [{"label": "Observed", "value": f["observed_rain_mm"]},
                 {"label": "Forecast", "value": f["forecast_rain_mm"]}],
    }))
    return ev


def events_for_tool_result(tool: str, result: dict) -> list[tuple[str, dict]]:
    if result.get("status") != "ok":
        return []
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
            "columns": ["Rainfall", "People (est.)", "Households (est.)", "Buildings", "Road km"], "rows": rows,
        }), ("chart", {
            "id": "compare-chart", "title": "People exposed by rainfall", "kind": "bar",
            "x_label": "Rainfall", "y_label": "People",
            "data": [{"label": r[0], "value": r[1]} for r in rows],
        })]
        if result["scenarios"]:
            ev += scenario_events(result["scenarios"][-1])[:2]
        return ev
    return []
