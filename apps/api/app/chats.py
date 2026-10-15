"""Saved chats for signed-in accounts: Firestore `chats/{account}/threads/{id}` (in memory when Firestore is unavailable).

A thread keeps the visible conversation (user and assistant messages and short notes about scenario runs) and the recipes of the runs,
never the map layers (they expire). Threads expire 90 days after the last save (TTL on `expires_at`)."""
import logging
import re
import threading
from datetime import datetime, timedelta, timezone

from pydantic import BaseModel, Field

from app.settings import settings

log = logging.getLogger(__name__)
COLLECTION = "chats"
SUBCOLLECTION = "threads"
TTL_DAYS = 90
MAX_THREADS = 50           # listed per account
MAX_MESSAGES = 150
ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
_lock = threading.Lock()
_mem: dict[tuple[str, str], dict] = {}
_fs = {"client": None, "broken": False}


class Run(BaseModel):
    kind: str = Field(pattern="^(what_if|forecast)$")
    area: str = Field(max_length=40)
    area_name: str = Field(default="", max_length=80)
    rainfall_mm: float | None = None
    duration_h: float | None = None
    horizon_days: int | None = None
    scenario_id: str | None = Field(default=None, max_length=64)


class Message(BaseModel):
    role: str = Field(pattern="^(user|assistant|activity)$")
    text: str = Field(max_length=6000)
    error: str | None = Field(default=None, max_length=600)
    run: Run | None = None


class Thread(BaseModel):
    title: str = Field(default="", max_length=120)
    created: str = Field(default="", max_length=40)
    updated: str = Field(default="", max_length=40)
    lang: str = Field(default="en", pattern="^(en|th)$")
    area: str | None = Field(default=None, max_length=40)
    messages: list[Message] = Field(default_factory=list, max_length=MAX_MESSAGES)


def valid_id(thread_id: str) -> bool:
    return bool(ID_RE.match(thread_id))


def _client():
    if _fs["client"] is not None:
        return _fs["client"]
    if _fs["broken"] or settings().geo_backend == "mock":
        return None
    try:
        from google.cloud import firestore
        _fs["client"] = firestore.Client(project=settings().project_id or None)
        return _fs["client"]
    except Exception as e:  # noqa: BLE001
        _fs["broken"] = True
        log.warning("Firestore unavailable, chats are kept in memory: %s", e)
        return None


def _break(e: Exception) -> None:
    if not _fs["broken"]:
        log.warning("Firestore error, chats are kept in memory: %s", e)
    _fs.update(client=None, broken=True)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _summary(thread_id: str, d: dict) -> dict:
    msgs = d.get("messages") or []
    return {"id": thread_id, "title": d.get("title", ""), "updated": d.get("updated", ""), "created": d.get("created", ""), "area": d.get("area"),
            "lang": d.get("lang", "en"), "count": len(msgs)}


def _title_of(t: Thread) -> str:
    if t.title.strip():
        return t.title.strip()[:120]
    first = next((m.text for m in t.messages if m.role == "user"), "")
    return (first.strip().replace("\n", " ") or "New chat")[:80]


def save(account: str, thread_id: str, t: Thread) -> dict:
    now = _now()
    doc = t.model_dump()
    doc["title"] = _title_of(t)
    doc["updated"] = now.isoformat(timespec="seconds")
    doc["created"] = t.created or doc["updated"]
    with _lock:
        _mem[(account, thread_id)] = doc
    c = _client()
    if c is not None:
        try:
            c.collection(COLLECTION).document(account).collection(SUBCOLLECTION).document(thread_id).set({**doc, "expires_at": now + timedelta(days=TTL_DAYS)})
        except Exception as e:  # noqa: BLE001
            _break(e)
    return _summary(thread_id, doc)


def get(account: str, thread_id: str) -> dict | None:
    c = _client()
    if c is not None:
        try:
            snap = c.collection(COLLECTION).document(account).collection(SUBCOLLECTION).document(thread_id).get()
            if snap.exists:
                d = snap.to_dict() or {}
                d.pop("expires_at", None)
                return d
            return None
        except Exception as e:  # noqa: BLE001
            _break(e)
    with _lock:
        return _mem.get((account, thread_id))


def listing(account: str) -> list[dict]:
    c = _client()
    if c is not None:
        try:
            q = c.collection(COLLECTION).document(account).collection(SUBCOLLECTION).order_by("updated", direction="DESCENDING").limit(MAX_THREADS)
            return [_summary(s.id, s.to_dict() or {}) for s in q.stream()]
        except Exception as e:  # noqa: BLE001
            _break(e)
    with _lock:
        rows = [_summary(i, d) for (a, i), d in _mem.items() if a == account]
    return sorted(rows, key=lambda r: r["updated"], reverse=True)[:MAX_THREADS]


def delete(account: str, thread_id: str) -> None:
    with _lock:
        _mem.pop((account, thread_id), None)
    c = _client()
    if c is not None:
        try:
            c.collection(COLLECTION).document(account).collection(SUBCOLLECTION).document(thread_id).delete()
        except Exception as e:  # noqa: BLE001
            _break(e)


def reset_memory() -> None:
    with _lock:
        _mem.clear()
