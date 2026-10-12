"""Map tool results to typed UI events so the UI never parses prose."""
from app.geo import mock

STATUS_LABELS = {
    "resolve_area": ("resolving_place", "Resolving place…"),
    "get_hazard_scenario": ("computing_hazard", "Computing hazard and exposure…"),
    "compare_scenarios": ("comparing", "Comparing scenarios…"),
    "explain_cell_or_village": ("explaining", "Explaining factors…"),
}


def status_for(tool: str) -> dict:
    stage, label = STATUS_LABELS.get(tool, (tool, f"Running {tool}…"))
    return {"stage": stage, "label": label}


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
        }),
        ("chart", {
            "id": f"{sid}-top", "title": f"Most exposed units in {a['name']} (people, est.)",
            "kind": "bar", "x_label": "Unit", "y_label": "People",
            "data": [{"label": u["name"], "value": u["people"]} for u in x["top_admin_units"]],
        }),
    ]
    return ev


def events_for_tool_result(tool: str, result: dict) -> list[tuple[str, dict]]:
    if result.get("status") != "ok":
        return []
    if tool == "get_hazard_scenario":
        return scenario_events(result)
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
