"""Scenario results go to Firestore, which refuses an array inside an array (the province outline is one)."""
from app.geo import cache


def _firestore_accepts(o) -> bool:
    if isinstance(o, dict):
        return all(isinstance(k, str) and k != "" and _firestore_accepts(v) for k, v in o.items())
    if isinstance(o, (list, tuple)):
        return not any(isinstance(v, (list, tuple)) for v in o) and all(_firestore_accepts(v) for v in o)
    return True


RESULT = {"scenario_id": "x", "area": {"name": "Nan", "geometry": {"type": "MultiPolygon", "coordinates": [[[[100.0, 18.0], [100.1, 18.1], [100.0, 18.0]]]]}},
          "exposure": {"tambon_table": [{"name": "a", "people": 1}], "top": [1, 2, 3]}}


def test_nested_arrays_are_stored_as_json_and_come_back_unchanged():
    assert not _firestore_accepts(RESULT)
    stored = cache._storable(RESULT)
    assert _firestore_accepts(stored)
    assert stored["exposure"]["top"] == [1, 2, 3] and stored["exposure"]["tambon_table"][0]["name"] == "a"      # plain arrays stay arrays
    assert cache._restored(stored) == RESULT


def test_a_write_the_database_refuses_does_not_switch_the_shared_cache_off(monkeypatch):
    monkeypatch.setattr(cache, "_fs_failed", False)
    cache._write_failed(ValueError("400 invalid nested entity"))
    assert cache._fs_failed is False
    cache._write_failed(type("PermissionDenied", (Exception,), {})("no access"))
    assert cache._fs_failed is True
    monkeypatch.setattr(cache, "_fs_failed", False)
