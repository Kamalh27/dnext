import pytest

from app.geo import rain
from app.geo import ee_backend as b


def test_gfs_windows_disjoint_and_complete():
    chosen = rain.gfs_windows(range(0, 49), 48)
    assert chosen == [6, 12, 18, 24, 30, 36, 42, 48]
    assert rain.gfs_covered_hours(chosen) == 48


def test_gfs_windows_partial_bucket_remainder():
    chosen = rain.gfs_windows(range(0, 20), 15)  # F=13..15 partial bucket -> take 15 (window 12-15)
    assert chosen == [6, 12, 15]
    assert rain.gfs_window(15) == (12, 15)
    assert rain.gfs_covered_hours(chosen) == 15


def test_gfs_windows_missing_f_and_3hourly():
    assert rain.gfs_windows([1, 2, 3, 7, 9], 24) == [3, 9]
    assert rain.gfs_windows([123, 126], 200) == [126]
    assert rain.gfs_windows([0, 200], 100) == []


def test_imerg_window():
    s, e = rain.imerg_window_ms(1_000_000_000_000, 15)
    assert e - s == 15 * rain.DAY_MS and e == 1_000_000_000_000 + 1_800_000


def test_wetness_clamp():
    assert rain.wetness(150, 300) == 0.5
    assert rain.wetness(900, 300) == 1.0
    assert rain.wetness(-5, 300) == 0.0
    assert rain.wetness(300) == 1.0  # config reference_mm=300


def test_rounding():
    assert b.round_people(1234) == 1200
    assert b.round_people(100_400) == 100_000
    assert b.round_people(123_456) == 123_000
    assert b.round_buildings(1234) == 1230


def test_class_areas_all_classes_present():
    out = b.groups_to_class_km2([{"class": 2, "sum": 5e6}, {"class": 4, "sum": 1.5e6}])
    assert out == {"Low": 0.0, "Moderate": 5.0, "High": 0.0, "Very High": 1.5}


def test_class_index():
    assert b.class_index("High") == 3
    with pytest.raises(ValueError):
        b.class_index("Extreme")


def _unit(code, name, pop, **kw):
    p = {"ADM3_PCODE": code, "ADM3_EN": name, "pop": pop, "bldg_count": pop / 4, "bldg_area": pop * 10,
         "road_m_primary": 2000, "road_m_local": 1000, "school_n": 1, "health_n": 0, "shelter_n": 1, "bridge_n": 0}
    p.update(kw)
    return p


def test_shape_exposure():
    units = [_unit("TH550101", "A", 1040), _unit("TH550102", "B", 5000), _unit("TH550103", "C", 0)]
    out = b.shape_exposure(units, "High", 2.5)
    assert out["people"] == 6000 and out["households_est"] == 2400
    assert out["buildings"] == 1510 and out["schools"] == 3 and out["shelters"] == 3
    assert out["road_km"] == 9.0 and out["road_km_by_class"]["primary"] == 6.0
    assert [u["name"] for u in out["top_admin_units"]] == ["B", "A"]  # zero-pop dropped, sorted
    assert out["top_admin_units"][0]["admin_code"] == "TH550102"


def test_shape_facilities_cap_and_points():
    feats = [{"geometry": {"type": "Point", "coordinates": [100.1, 18.2]}, "properties": {"name": "S", "kind": "school"}}] * 300
    feats.append({"geometry": {"type": "Polygon", "coordinates": []}, "properties": {}})
    out = b.shape_facilities(feats)
    assert len(out) == 200 and out[0] == {"lat": 18.2, "lng": 100.1, "name": "S", "kind": "school"}


def test_shape_explain():
    from app.geo.ee_model import FACTOR_BANDS
    w = {k: 1 / len(FACTOR_BANDS) for k in FACTOR_BANDS}
    props = {k: 0.5 for k in FACTOR_BANDS}
    props["slope"] = 1.0
    out = b.shape_explain(props, w)
    assert out["factors"][0]["name"] == "slope"
    assert 0 <= out["S"] <= 1 and "summary" in out


def test_limitations_mention_key_caveats():
    text = " ".join(b.base_limitations()).lower()
    for w in ("screening", "uniform", "households", "2020", "building", "openstreetmap"):
        assert w in text
