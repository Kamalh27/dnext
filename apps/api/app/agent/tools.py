"""ADK tools. Each returns JSON-able dict with units, sources, limitations. All figures come from here."""
import logging

from app import briefing
from app.geo import overview, service
from app.geo.areas import AreaError, resolve

log = logging.getLogger("tools")
DEFAULT_RAIN_MM, DEFAULT_DURATION_H = 250.0, 72.0


def _err(e: Exception) -> dict:
    return {"status": "error", "message": str(e) or type(e).__name__}


def resolve_area(query: str) -> dict:
    """Resolve a Thai place name (English or Thai) to an area with bounding box.

    Args:
        query: Place name, e.g. "Nan" or "เชียงใหม่".
    """
    try:
        return {"status": "ok", **resolve(query).dict()}
    except AreaError as e:
        return {"status": "error", "message": str(e)}
    except Exception as e:
        log.exception("resolve failed")
        return _err(e)


def get_hazard_scenario(area: str, rainfall_mm: float, duration_h: float = 72) -> dict:
    """Compute landslide risk for a what-if rainfall over an area: trigger and risk layers, the tambon-level risk and
    exposure table, and people (estimate) living where risk is Moderate or higher. The scenario rainfall is added to the observed
    rainfall of the preceding days to form the 30-day total that the tambon thresholds use.

    Args:
        area: Place name (resolved internally).
        rainfall_mm: Total rainfall depth in millimetres.
        duration_h: Rainfall duration in hours (default 72).
    """
    try:
        return {"status": "ok", **service.run_scenario(resolve(area), rainfall_mm, duration_h)}
    except (AreaError, ValueError) as e:
        return _err(e)
    except Exception as e:
        log.exception("scenario failed")
        return _err(e)


def compare_scenarios(area: str, rainfall_mm_list: list[float], duration_h: float = 72) -> dict:
    """Compare several rainfall depths for the same area side by side.

    Args:
        area: Place name.
        rainfall_mm_list: Rainfall depths in mm to compare, e.g. [150, 300].
        duration_h: Duration in hours for all scenarios.
    """
    try:
        if not rainfall_mm_list:
            return {"status": "error", "message": "Provide at least one rainfall depth to compare."}
        a = resolve(area)
        runs = [service.run_scenario(a, r, duration_h) for r in rainfall_mm_list[:5]]
    except (AreaError, ValueError) as e:
        return _err(e)
    except Exception as e:
        log.exception("compare failed")
        return _err(e)
    return {"status": "ok", "area": a.dict(), "scenarios": runs}


def explain_cell_or_village(lat: float, lng: float, scenario_id: str = "") -> dict:
    """Explain which factors drive the susceptibility at a coordinate.

    Args:
        lat: Latitude.
        lng: Longitude.
        scenario_id: Optional id of an earlier scenario for context.
    """
    try:
        if not (5.5 <= lat <= 20.6 and 97.3 <= lng <= 105.7):
            return {"status": "error", "message": "Coordinate is outside Thailand; the model covers Thailand only."}
        return {"status": "ok", **service.explain_point(lat, lng, scenario_id or None)}
    except Exception as e:
        log.exception("explain failed")
        return _err(e)


def get_forecast_hazard(area: str, horizon_days: int = 5) -> dict:
    """Landslide hazard and exposure from observed (last days) plus forecast rainfall over a horizon.
    Reports observed rainfall, forecast rainfall and the forecast model run time.

    Args:
        area: Place name.
        horizon_days: Forecast horizon in days (1-10, default 5).
    """
    try:
        return {"status": "ok", **service.run_forecast(resolve(area), int(horizon_days))}
    except (AreaError, ValueError) as e:
        return _err(e)
    except Exception as e:
        log.exception("forecast failed")
        return _err(e)


def get_top_provinces(horizon_days: int = 0, limit: int = 5) -> dict:
    """Rank Thailand's provinces by landslide risk. Use this for "which provinces are at highest risk now / today / this week", never get_forecast_hazard
    on a guessed province. horizon_days 0 = latest observed conditions; 1-5 = observed + forecast rain up to that many days ahead (use 5 for "this week").
    Returns the top provinces with their risk class, peak tambon risk, tambons above their rainfall trigger and people (est.) in the Moderate-or-higher zone.

    Args:
        horizon_days: 0 (latest observed) to 5 (cumulative forecast).
        limit: How many provinces to return, 1-10 (default 5).
    """
    try:
        h, n = int(horizon_days), int(limit)
        if not 0 <= h <= 5:
            return {"status": "error", "message": "horizon_days must be between 0 and 5."}
        return {"status": "ok", **overview.top_provinces(h, n)}
    except overview.OverviewUnavailable as e:
        return _err(e)
    except Exception as e:
        log.exception("top provinces failed")
        return _err(e)


def get_top_tambons(area: str, horizon_days: int = 0, limit: int = 5) -> dict:
    """The highest-risk tambons inside one province or district. Use this for "which tambons in X are at highest risk" (without a rainfall amount).
    top_now = tambons above their rainfall trigger today (or on the forecast day) on landslide-prone ground; it is empty when none is.
    top_if_rain_reaches_the_top_trigger = where heavy rain would hurt most (the ground: susceptibility x vulnerability x exposure). It is not a forecast.

    Args:
        area: A province (or district) name.
        horizon_days: 0 (latest observed) to 5 (cumulative forecast).
        limit: How many tambons to return, 1-10 (default 5).
    """
    try:
        h, n = int(horizon_days), int(limit)
        if not 0 <= h <= 5:
            return {"status": "error", "message": "horizon_days must be between 0 and 5."}
        a = resolve(area)
        code = getattr(a, "pcode", None) or getattr(a, "admin_code", None)
        if a.level not in ("province", "amphoe") or not code:
            return {"status": "error", "message": "Give a province or a district, not a single tambon or a coordinate."}
        out = overview.top_tambons({"level": a.level, "pcode": code}, h, n)
        return {"status": "ok", "area": {"name": a.name, "name_th": a.name_th, "level": a.level}, **out}
    except (AreaError, overview.OverviewUnavailable) as e:
        return _err(e)
    except Exception as e:
        log.exception("top tambons failed")
        return _err(e)


def get_exposure(area: str, scenario_id: str = "", min_class: str = "High") -> dict:
    """Get exposed people, households (est.), buildings, roads and facilities for a scenario.
    Uses the cached scenario if scenario_id is given; otherwise runs a default 250 mm / 72 h scenario
    (the result states the rainfall used).

    Args:
        area: Place name.
        scenario_id: Id of an earlier scenario (optional).
        min_class: Minimum hazard class counted as exposed: Moderate, High or Very High.
    """
    try:
        sc = service.get_cached(scenario_id) if scenario_id else None
        assumed = False
        if sc is None or sc["exposure"].get("min_class", "High") != min_class:
            if sc is not None and sc.get("kind") == "what_if":
                sc = service.run_scenario(resolve(area), sc["rainfall_mm"], sc["duration_h"], min_class)
            elif sc is None:
                assumed = True
                sc = service.run_scenario(resolve(area), DEFAULT_RAIN_MM, DEFAULT_DURATION_H, min_class)
        out = {"status": "ok", "scenario_id": sc["scenario_id"], "area": sc["area"],
               "rainfall_mm": sc["rainfall_mm"], "duration_h": sc["duration_h"], "exposure": sc["exposure"]}
        if assumed:
            out["note"] = f"No scenario given: assumed {DEFAULT_RAIN_MM:.0f} mm over {DEFAULT_DURATION_H:.0f} h."
        return out
    except (AreaError, ValueError) as e:
        return _err(e)
    except Exception as e:
        log.exception("exposure failed")
        return _err(e)


def generate_briefing(scenario_id: str, language: str = "en") -> dict:
    """Generate a markdown briefing for an existing scenario (numbers come only from the scenario).

    Args:
        scenario_id: Id returned by get_hazard_scenario or get_forecast_hazard.
        language: "en" or "th".
    """
    try:
        sc = service.get_cached(scenario_id)
        if sc is None:
            return {"status": "error", "message": f"Unknown or expired scenario_id '{scenario_id}'. Run a scenario first."}
        lang = "th" if language == "th" else "en"
        return {"status": "ok", "scenario_id": scenario_id, "language": lang,
                "markdown": briefing.build_briefing(sc, lang),
                "download_path": f"/briefing/{scenario_id}?language={lang}"}
    except Exception as e:
        log.exception("briefing failed")
        return _err(e)


TOOLS = [resolve_area, get_hazard_scenario, get_forecast_hazard, get_top_provinces, get_top_tambons, get_exposure, compare_scenarios,
         explain_cell_or_village, generate_briefing]
