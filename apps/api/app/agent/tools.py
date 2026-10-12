"""ADK tools. Each returns JSON-able dict with units, sources, limitations. All figures come from here."""
from app.geo import service
from app.geo.areas import AreaError, resolve


def resolve_area(query: str) -> dict:
    """Resolve a Thai place name (English or Thai) to an area with bounding box.

    Args:
        query: Place name, e.g. "Nan" or "เชียงใหม่".
    """
    try:
        return {"status": "ok", **resolve(query).dict()}
    except AreaError as e:
        return {"status": "error", "message": str(e)}


def get_hazard_scenario(area: str, rainfall_mm: float, duration_h: float = 72) -> dict:
    """Compute landslide hazard classes for uniform rainfall over an area, and the exposed people,
    households (estimate), buildings, road km and facilities in High/Very High zones.

    Args:
        area: Place name (resolved internally).
        rainfall_mm: Total rainfall depth in millimetres.
        duration_h: Rainfall duration in hours (default 72).
    """
    try:
        return {"status": "ok", **service.run_scenario(resolve(area), rainfall_mm, duration_h)}
    except (AreaError, ValueError) as e:
        return {"status": "error", "message": str(e)}


def compare_scenarios(area: str, rainfall_mm_list: list[float], duration_h: float = 72) -> dict:
    """Compare several rainfall depths for the same area side by side.

    Args:
        area: Place name.
        rainfall_mm_list: Rainfall depths in mm to compare, e.g. [150, 300].
        duration_h: Duration in hours for all scenarios.
    """
    try:
        a = resolve(area)
        runs = [service.run_scenario(a, r, duration_h) for r in rainfall_mm_list[:5]]
    except (AreaError, ValueError) as e:
        return {"status": "error", "message": str(e)}
    return {"status": "ok", "area": a.dict(), "scenarios": runs}


def explain_cell_or_village(lat: float, lng: float) -> dict:
    """Explain which factors drive the susceptibility at a coordinate.

    Args:
        lat: Latitude.
        lng: Longitude.
    """
    return {"status": "ok", **service.explain_point(lat, lng)}


TOOLS = [resolve_area, get_hazard_scenario, compare_scenarios, explain_cell_or_village]
