"""Pure-python tests for the data-pipeline scripts (no EE/network)."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))

import _common  # noqa: E402
import build_exposure_stack as bes  # noqa: E402
import fetch_osm  # noqa: E402
import upload_admin  # noqa: E402
import validate_susceptibility as vs  # noqa: E402


def test_auc_known_values():
    assert vs.auc([0.9, 0.8], [0.1, 0.2]) == 1.0
    assert vs.auc([0.1], [0.9]) == 0.0
    assert vs.auc([0.5, 0.5], [0.5, 0.5]) == 0.5
    # pos=[3,2], neg=[1,2.5]: 3>1, 3>2.5, 2>1, 2<2.5 -> 3/4
    assert vs.auc([3, 2], [1, 2.5]) == pytest.approx(0.75)


def test_spearman():
    assert vs.spearman([1, 2, 3, 4], [10, 20, 30, 40]) == pytest.approx(1.0)
    assert vs.spearman([1, 2, 3, 4], [4, 3, 2, 1]) == pytest.approx(-1.0)


def test_filter_glc_accuracy_and_mekong_fallback():
    rows = [{"country_code": "TH", "location_accuracy": "exact", "longitude": "100", "latitude": "18"},
            {"country_code": "TH", "location_accuracy": "50km", "longitude": "100", "latitude": "18"},
            {"country_code": "LA", "location_accuracy": "1km", "longitude": "102", "latitude": "19"}]
    # fewer than 30 TH points -> Mekong bbox, accuracy filter still applied
    assert sorted(vs.filter_glc(rows, vs.MEKONG_BBOX)) == [(100.0, 18.0), (102.0, 19.0)]


def test_update_assets_local_preserves_keys(tmp_path):
    import yaml
    f = tmp_path / "assets.local.yaml"
    f.write_text('# header\nsusceptibility_asset: ""\nexposure_stack_asset: "old"\n')
    _common.update_assets_local("susceptibility_asset", "projects/p/assets/x", f)
    _common.update_assets_local("new_key", "v", f)
    t = f.read_text()
    assert "# header" in t and 'exposure_stack_asset: "old"' in t
    assert t.count("susceptibility_asset") == 1
    d = yaml.safe_load(t)
    assert d["susceptibility_asset"] == "projects/p/assets/x" and d["new_key"] == "v"


def test_asset_folder_and_regions():
    assert _common.asset_folder("p") == "projects/p/assets/landslidewatch"
    assert _common.region_bbox("bbox") == [97.3, 5.6, 105.7, 20.5]
    with pytest.raises(ValueError):
        _common.region_bbox("x")


@pytest.mark.parametrize("tags,cls", [
    ({"highway": "motorway"}, "primary"), ({"highway": "trunk_link"}, "primary"),
    ({"highway": "secondary"}, "secondary"), ({"highway": "tertiary"}, "tertiary"),
    ({"highway": "residential"}, "local"), ({"highway": "service"}, "local"),
    ({"highway": "unclassified"}, "local"), ({"highway": "track"}, "track"),
    ({"highway": "footway"}, None), ({}, None)])
def test_highway_class(tags, cls):
    assert fetch_osm.highway_class(tags) == cls


@pytest.mark.parametrize("tags,kind", [
    ({"amenity": "school"}, "school"), ({"amenity": "clinic"}, "hospital"), ({"amenity": "doctors"}, "hospital"),
    ({"emergency": "assembly_point"}, "shelter"), ({"amenity": "shelter"}, "shelter"),
    ({"amenity": "social_facility", "social_facility": "shelter"}, "shelter"),
    ({"amenity": "social_facility", "social_facility": "group_home"}, None),
    ({"highway": "primary", "bridge": "yes"}, "bridge"), ({"amenity": "bank"}, None)])
def test_facility_kind(tags, kind):
    assert fetch_osm.facility_kind(tags) == kind


def test_segment_midpoints_preserve_length():
    line = [(100.0, 18.0), (100.0, 18.01)]
    total = fetch_osm.line_length_m(line)
    pieces = fetch_osm.segment_midpoints(line, 100)
    assert len(pieces) == 12
    assert sum(p[2] for p in pieces) == pytest.approx(total)
    assert all(18.0 < p[1] < 18.01 for p in pieces)


def test_building_fallback_arithmetic():
    count, area = bes.ghsl_fallback(1200.0, 60.0)
    assert count == 20.0 and area == 1200.0
    assert bes.choose_building_source(0) == "ghsl_built_s_2020"
    assert bes.choose_building_source(10) == "open_buildings_v3"
    assert len(bes.BANDS) == 12 and bes.BANDS[0] == "pop"


def test_admin_index_synthetic():
    sq = lambda x, y, s=1: {"type": "Polygon", "coordinates": [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]]}
    recs = [{"level": 2, "pcode": "TH1001", "name_en": "A", "name_th": "ก", "parent_pcode": "TH10", "geometry": sq(100, 13)},
            {"level": 1, "pcode": "TH10", "name_en": "P", "name_th": "ป", "geometry": sq(99, 12, 3)}]
    idx = upload_admin.build_admin_index(recs)
    assert [r["level"] for r in idx] == [1, 2]
    assert idx[1]["bbox"] == [100, 13, 101, 14] and idx[1]["parent_pcode"] == "TH10"
    assert idx[0]["parent_pcode"] is None and "geometry" not in idx[0]
    assert upload_admin.point_in_geom(100.5, 13.5, sq(100, 13))
    assert not upload_admin.point_in_geom(105, 13.5, sq(100, 13))


def test_admin_index_from_geodataframe():
    gpd = pytest.importorskip("geopandas")
    from shapely.geometry import box
    gdf = gpd.GeoDataFrame({"ADM3_PCODE": ["TH100101"], "ADM3_EN": ["T"], "ADM3_TH": ["ต"], "ADM2_PCODE": ["TH1001"]},
                           geometry=[box(100, 13, 100.1, 13.1)], crs=4326)
    idx = upload_admin.build_admin_index(upload_admin.gdf_to_records(gdf, 3))
    assert idx[0]["pcode"] == "TH100101" and idx[0]["parent_pcode"] == "TH1001" and idx[0]["name_th"] == "ต"


@pytest.mark.parametrize("mod,args", [("precompute_susceptibility", ["--dry-run", "--region", "nan"]),
                                      ("upload_admin", ["--dry-run", "--zip", "x.zip"]),
                                      ("fetch_osm", ["--dry-run"]), ("build_exposure_stack", ["--dry-run"]),
                                      ("validate_susceptibility", ["--dry-run"])])
def test_dry_run_smoke(mod, args, capsys):
    import importlib
    assert importlib.import_module(mod).main(args) == 0
    assert "[dry-run]" in capsys.readouterr().out
