import pytest

from app.settings import settings

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not settings().ee_project, reason="EE_PROJECT not set"),
]


def _nan():
    from app.geo.areas import resolve
    return resolve("Nan")


def test_nan_scenario_class_areas_sum_to_aoi():
    import ee
    from app.geo import ee_backend as b
    from app.geo.ee_init import get_info
    area = _nan()
    out = b.hazard_scenario(area, 250, 72)
    total = sum(out["class_area_km2"].values())
    aoi = get_info(b._aoi(area).area(1)) / 1e6
    assert abs(total - aoi) / aoi < 0.02
    assert out["tile_url"].startswith("http") and "{z}" in out["tile_url"]
    assert out["date_of_data"] and out["data_sources"]


def test_susceptibility_in_unit_interval():
    from app.geo import ee_backend as b
    from app.geo.ee_init import get_info
    import ee
    s, _ = b._susceptibility(b._aoi(_nan()))
    r = get_info(s.reduceRegion(ee.Reducer.minMax(), b._aoi(_nan()), 500, bestEffort=True, maxPixels=int(1e8)))
    assert 0 <= r["S_min"] and r["S_max"] <= 1


def test_exposure_shape():
    from app.geo import ee_backend as b
    out = b.exposure(_nan(), 250, 72, "High")
    assert out["people"] is not None and out["limitations"]
