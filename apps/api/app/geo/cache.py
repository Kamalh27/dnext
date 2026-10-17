"""Scenario cache: Firestore (collection `scenarios`, TTL field `expires_at`) with in-memory fallback.

Falls back automatically when GEO_BACKEND=mock or Firestore is unavailable (logged once)."""
import json
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


_warned: set = set()


def _write_failed(e: Exception) -> None:
    """One result that cannot be stored must not turn off the shared cache for everyone: only a missing permission or credentials does that."""
    name = type(e).__name__
    if name in ("PermissionDenied", "Unauthenticated", "DefaultCredentialsError", "Forbidden"):
        return _disable_fs(e)
    if name not in _warned:
        _warned.add(name)
        log.warning("scenario not stored in Firestore (kept in memory): %s", str(e)[:160])


def _disable_fs(e: Exception) -> None:
    global _fs, _fs_failed
    if not _fs_failed:
        log.warning("Firestore error, switching to in-memory scenario cache: %s", e)
    _fs, _fs_failed = None, True


_JSON = "nested_json_string"


def _storable(o):
    """Firestore does not accept an array directly inside an array (the province outline is one: GeoJSON coordinates). Such a value is stored as a JSON
    string under a marker key and put back on read; everything else is stored as it is."""
    if isinstance(o, dict):
        return {k: _storable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        if any(isinstance(v, (list, tuple)) for v in o):
            return {_JSON: json.dumps(o, separators=(",", ":"))}
        return [_storable(v) for v in o]
    return o


def _restored(o):
    if isinstance(o, dict):
        if set(o) == {_JSON}:
            return json.loads(o[_JSON])
        return {k: _restored(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_restored(v) for v in o]
    return o


def put(sid: str, result: dict, ttl_s: int = TTL_WHATIF_S) -> None:
    with _lock:
        _mem[sid] = (time.time() + ttl_s, result)
    c = _client()
    if c is None:
        return
    try:
        exp = datetime.now(timezone.utc) + timedelta(seconds=ttl_s)
        c.collection(COLLECTION).document(sid).set({"result": _storable(result), "expires_at": exp})
    except Exception as e:
        _write_failed(e)


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
        res = _restored(d.get("result"))
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
