import threading
import time

from app.geo import obs_cache, overview


def _setup(monkeypatch):
    overview._memo.clear()
    overview._inflight.clear()
    monkeypatch.setattr(obs_cache, "load", lambda: {"newest_ms": 1, "forecast": {"run_ms": 2}})
    calls = {"n": 0}
    done = threading.Event()

    def compute():
        calls["n"] += 1
        overview._memo["k"] = (time.time(), {"v": calls["n"]}, overview._sig(obs_cache.load()))
        done.set()
        return {"v": calls["n"]}
    return calls, done, compute


def test_fresh_result_is_not_recomputed(monkeypatch):
    calls, _, compute = _setup(monkeypatch)
    assert overview._swr("k", compute) == {"v": 1}
    assert overview._swr("k", compute) == {"v": 1}
    assert calls["n"] == 1


def test_stale_result_is_served_at_once_and_refreshed_in_the_background(monkeypatch):
    calls, done, compute = _setup(monkeypatch)
    overview._swr("k", compute)
    done.clear()
    t, out, sig = overview._memo["k"]
    overview._memo["k"] = (t - overview._TTL_S - 5, out, sig)      # expired, but within the stale window
    assert overview._swr("k", compute) == {"v": 1}                  # answered immediately with the old value
    assert done.wait(2) and calls["n"] == 2                         # and recomputed once behind it
    assert overview._swr("k", compute) == {"v": 2}


def test_too_old_result_is_recomputed_inline(monkeypatch):
    calls, _, compute = _setup(monkeypatch)
    overview._swr("k", compute)
    t, out, sig = overview._memo["k"]
    overview._memo["k"] = (t - overview._MAX_STALE_S - 5, out, sig)
    assert overview._swr("k", compute) == {"v": 2}


def test_new_daily_file_triggers_a_refresh_not_a_wait(monkeypatch):
    calls, done, compute = _setup(monkeypatch)
    overview._swr("k", compute)
    done.clear()
    monkeypatch.setattr(obs_cache, "load", lambda: {"newest_ms": 99, "forecast": {"run_ms": 2}})
    assert overview._swr("k", compute) == {"v": 1}
    assert done.wait(2) and calls["n"] == 2
