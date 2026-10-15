"""Simultaneous overview requests share one computation, and the job's precomputed overview is used only for the rainfall file it was made from."""
import json
import threading
import time

from app.geo import obs_cache, overview


def test_simultaneous_requests_compute_once(monkeypatch):
    monkeypatch.setattr(overview, "_memo", {})
    monkeypatch.setattr(obs_cache, "load", lambda: {"newest_ms": 1, "forecast": {"run_ms": 2}})
    calls = []

    def compute():
        calls.append(1)
        time.sleep(0.3)
        overview._memo["k"] = (time.time(), {"ok": True}, overview._sig(obs_cache.load()))
        return {"ok": True}

    out = []
    ts = [threading.Thread(target=lambda: out.append(overview._swr("k", compute))) for _ in range(6)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert len(calls) == 1 and out == [{"ok": True}] * 6


def test_precomputed_overview_needs_a_matching_rainfall_file(tmp_path, monkeypatch):
    monkeypatch.setattr(overview, "SERIES_LOCAL", tmp_path / "overview_series.json")
    sig = (111, 222)
    series = {"date_of_data": "2026-10-13", "max_days": 5, "days": [{"h": h} for h in range(6)]}
    (tmp_path / "overview_series.json").write_text(json.dumps({"sig": list(sig), "series": series}))
    got = overview._series_file(3, sig)
    assert got and [d["h"] for d in got["days"]] == [0, 1, 2, 3] and got["max_days"] == 3
    assert overview._series_file(5, sig)["max_days"] == 5
    assert overview._series_file(5, (999, 222)) is None          # a newer rainfall file: compute again
    assert overview._series_file(7, sig) is None                 # more days than the file holds
