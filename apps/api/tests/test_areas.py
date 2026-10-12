import json

import pytest

from app.geo import areas
from app.geo.areas import AreaError, resolve


@pytest.fixture(autouse=True)
def _no_key(monkeypatch):
    monkeypatch.delenv("GOOGLE_MAPS_SERVER_KEY", raising=False)
    monkeypatch.setattr(areas, "_index_path", lambda: areas.Path("/nonexistent/admin_index.json"))


def test_77_provinces_unique():
    rows = areas._builtin_entries()
    assert len(rows) == 77 and len({r["pcode"] for r in rows}) == 77
    for r in rows:
        w, s, e, n = r["bbox"]
        assert 97 < w < e < 106 and 5 < s < n < 21


def test_exact_en_th():
    a = resolve("Nan")
    assert (a.admin_code, a.level, a.pcode) == ("TH55", "province", "TH55")
    assert resolve("nan").name == "Nan"
    assert resolve("เชียงใหม่").name == "Chiang Mai"
    assert resolve("จังหวัดแม่ฮ่องสอน").name == "Mae Hong Son"
    assert resolve("Changwat Chiang Rai").admin_code == "TH57"
    assert resolve("Korat").name == "Nakhon Ratchasima"
    d = resolve("Phuket").dict()
    assert d["geometry"] is None and len(d["bbox"]) == 4 and d["approx"] is True


@pytest.mark.parametrize("typo,expected", [("Chiang Maai", "Chiang Mai"), ("Mae Hong Sorn", "Mae Hong Son"),
                                           ("Nakhon Si Thamarat", "Nakhon Si Thammarat"), ("เชียงรายย", "Chiang Rai")])
def test_fuzzy(typo, expected):
    assert resolve(typo).name == expected


@pytest.mark.parametrize("q", ["Tokyo", "Vientiane", "Paris", "", "   "])
def test_outside_thailand_local(q):
    with pytest.raises(AreaError):
        resolve(q)


def test_geocode_rejects_non_th(monkeypatch):
    monkeypatch.setenv("GOOGLE_MAPS_SERVER_KEY", "k")
    monkeypatch.setattr(areas, "_geocode_fetch", lambda p: {"results": [{
        "types": ["locality"], "address_components": [{"long_name": "Vientiane", "short_name": "Vientiane", "types": ["locality"]},
                                                      {"long_name": "Laos", "short_name": "LA", "types": ["country"]}],
        "geometry": {"viewport": {"northeast": {"lat": 18, "lng": 103}, "southwest": {"lat": 17.9, "lng": 102.5}}}}]})
    with pytest.raises(AreaError, match="outside Thailand"):
        resolve("Vientiane")


def test_geocode_th_hit_and_params(monkeypatch):
    monkeypatch.setenv("GOOGLE_MAPS_SERVER_KEY", "k")
    seen = {}

    def fake(p):
        seen.update(p)
        return {"results": [{"types": ["administrative_area_level_2"],
                             "address_components": [{"long_name": "Pai", "short_name": "Pai", "types": ["administrative_area_level_2"]},
                                                    {"long_name": "Mae Hong Son", "short_name": "MHS", "types": ["administrative_area_level_1"]},
                                                    {"long_name": "Thailand", "short_name": "TH", "types": ["country"]}],
                             "geometry": {"viewport": {"northeast": {"lat": 19.5, "lng": 98.6}, "southwest": {"lat": 19.2, "lng": 98.3}}}}]}
    monkeypatch.setattr(areas, "_geocode_fetch", fake)
    a = resolve("Pai Village Quarry Zone")
    assert a.level == "amphoe" and a.parent == "Mae Hong Son" and a.bbox == [98.3, 19.2, 98.6, 19.5]
    assert seen["components"] == "country:TH" and seen["region"] == "th" and seen["language"] == "en"


@pytest.fixture
def index(tmp_path, monkeypatch):
    rows = [
        {"level": "province", "pcode": "TH55", "name_en": "Nan", "name_th": "น่าน", "bbox": [100.4, 18.1, 101.4, 19.65], "parent_pcode": None},
        {"level": "province", "pcode": "TH58", "name_en": "Mae Hong Son", "name_th": "แม่ฮ่องสอน", "bbox": [97.3, 17.3, 98.6, 19.8], "parent_pcode": None},
        {"level": "amphoe", "pcode": "TH5501", "name_en": "Mueang Nan", "name_th": "เมืองน่าน", "bbox": [100.6, 18.6, 100.9, 18.9], "parent_pcode": "TH55"},
        {"level": "amphoe", "pcode": "TH5801", "name_en": "Mueang Mae Hong Son", "name_th": "เมืองแม่ฮ่องสอน", "bbox": [97.7, 19.1, 98.0, 19.5], "parent_pcode": "TH58"},
        {"level": "tambon", "pcode": "TH550101", "name_en": "Nai Wiang", "name_th": "ในเวียง", "bbox": [100.7, 18.75, 100.8, 18.82], "parent_pcode": "TH5501"},
        {"level": "tambon", "pcode": "TH580101", "name_en": "Pang Mu", "name_th": "ปางหมู", "bbox": [97.9, 19.2, 98.1, 19.4], "parent_pcode": "TH5801"},
        {"level": "tambon", "pcode": "TH550102", "name_en": "Ban Pong", "name_th": "บ้านโป่ง", "bbox": [100.7, 18.7, 100.8, 18.8], "parent_pcode": "TH5501"},
        {"level": "tambon", "pcode": "TH580102", "name_en": "Ban Pong", "name_th": "บ้านโป่ง", "bbox": [97.9, 19.0, 98.0, 19.1], "parent_pcode": "TH5801"},
    ]
    p = tmp_path / "admin_index.json"
    p.write_text(json.dumps(rows), encoding="utf-8")
    monkeypatch.setattr(areas, "_index_path", lambda: p)
    return p


def test_index_levels_and_prefixes(index):
    a = resolve("Nai Wiang")
    assert (a.level, a.parent, a.approx) == ("tambon", "Mueang Nan", False)
    assert resolve("ตำบลปางหมู").name == "Pang Mu"
    assert resolve("Tambon Pang Muu").name == "Pang Mu"
    assert resolve("อำเภอเมืองน่าน").level == "amphoe"
    assert resolve("Amphoe Mueang Nan").pcode == "TH5501"


def test_index_province_wins_tie(index):
    assert resolve("Nan").level == "province"


def test_index_ambiguous_candidates_and_disambiguation(index):
    with pytest.raises(AreaError) as ei:
        resolve("Ban Pong")
    c = ei.value.candidates
    assert len(c) == 2 and {x["parent"] for x in c} == {"Mueang Nan", "Mueang Mae Hong Son"}
    assert resolve("Ban Pong, Mueang Nan").pcode == "TH550102"
    assert resolve("บ้านโป่ง, เมืองแม่ฮ่องสอน").pcode == "TH580102"


def test_index_missing_falls_back_to_builtin(monkeypatch, tmp_path):
    monkeypatch.setattr(areas, "_index_path", lambda: tmp_path / "nope.json")
    assert resolve("Nan").approx is True
