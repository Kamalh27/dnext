"""Scenario cache: Firestore (collection `scenarios`, TTL field `expires_at`) with in-memory fallback.

Falls back automatically when GEO_BACKEND=mock or Firestore is unavailable (logged once)."""
import logging
import threading
import time
from datetime import datetime, timedelta, timezone

from app.settings import settings

log = logging.getLogger("cache")
COLLECTION = "scenarios"
TTL_FORECAST_S = 24 * 3600
TTL_WHATIF_S = 30 * 24 * 3600

_mem: dict[str, tuple[float, dict]] = {}   # sid -> (expires_epoch, result)
_lock = threading.Lock()
_fs = None
_fs_failed = False


def _client():
    """Firestore client, or None if we should use memory."""
    global _fs, _fs_failed
    if _fs is not None:
        return _fs
    if _fs_failed or settings().geo_backend == "mock":
        return None
    try:
        from google.cloud import firestore
        _fs = firestore.Client(project=settings().project_id or None)
        return _fs
    except Exception as e:  # no creds / no project
        _fs_failed = True
        log.warning("Firestore unavailable, using in-memory scenario cache: %s", e)
        return None


def _disable_fs(e: Exception) -> None:
    global _fs, _fs_failed
    if not _fs_failed:
        log.warning("Firestore error, switching to in-memory scenario cache: %s", e)
    _fs, _fs_failed = None, True


def put(sid: str, result: dict, ttl_s: int = TTL_WHATIF_S) -> None:
    with _lock:
        _mem[sid] = (time.time() + ttl_s, result)
    c = _client()
    if c is None:
        return
    try:
        exp = datetime.now(timezone.utc) + timedelta(seconds=ttl_s)
        c.collection(COLLECTION).document(sid).set({"result": result, "expires_at": exp})
    except Exception as e:
        _disable_fs(e)


def get(sid: str) -> dict | None:
    with _lock:
        hit = _mem.get(sid)
        if hit and hit[0] > time.time():
            return hit[1]
        _mem.pop(sid, None)
    c = _client()
    if c is None:
        return None
    try:
        snap = c.collection(COLLECTION).document(sid).get()
        if not snap.exists:
            return None
        d = snap.to_dict() or {}
        exp = d.get("expires_at")
        if exp is not None and exp <= datetime.now(timezone.utc):
            return None
        res = d.get("result")
        if res:
            with _lock:
                _mem[sid] = (time.time() + 3600, res)
        return res
    except Exception as e:
        _disable_fs(e)
        return None


def clear() -> None:
    with _lock:
        _mem.clear()
