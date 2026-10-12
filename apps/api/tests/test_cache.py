import time

from app.geo import cache


def test_roundtrip_and_ttl():
    cache.put("t1", {"a": 1}, 100)
    assert cache.get("t1") == {"a": 1}
    cache.put("t2", {"a": 2}, -1)
    assert cache.get("t2") is None
    assert cache.get("missing") is None


def test_ttl_constants():
    assert cache.TTL_FORECAST_S == 86400 and cache.TTL_WHATIF_S == 30 * 86400


def test_firestore_failure_falls_back(monkeypatch):
    class Boom:
        def collection(self, *_):
            raise RuntimeError("no firestore")
    monkeypatch.setattr(cache, "_client", lambda: Boom())
    cache.put("t3", {"x": 1})            # must not raise
    assert cache.get("t3") == {"x": 1}   # memory copy


def test_storage_local(tmp_path):
    from app.geo import storage
    p = storage.upload("../evil.md", "hi")
    assert p.endswith("briefings/evil.md") and open(p).read() == "hi"
