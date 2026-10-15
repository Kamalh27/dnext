"""Per-account usage limits: daily counters (Firestore, shared by all instances; in-memory fallback) + a per-minute burst limit."""
import logging
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.settings import settings

log = logging.getLogger(__name__)
_lock = threading.Lock()
_mem: dict[tuple[str, str], dict[str, int]] = defaultdict(dict)       # (uid, day) -> {kind: count}   (fallback + tests)
_burst: dict[str, deque] = defaultdict(deque)
_fs = {"client": None, "broken": False}


@dataclass
class Result:
    ok: bool
    reason: str = ""            # "" | "daily_limit" | "burst_limit"
    used: int = 0
    limit: int = 0
    retry_after_s: int = 0

    def detail(self, kind: str) -> dict:
        reset = (datetime.now(ZoneInfo(settings().usage_timezone)) + timedelta(seconds=self.retry_after_s)).isoformat(timespec="seconds")
        msg = ("Too many requests in a short time; please wait a moment." if self.reason == "burst_limit"
               else f"Daily limit reached ({self.used}/{self.limit}). It resets at midnight (Thailand time).")
        return {"code": self.reason or "rate_limited", "kind": kind, "used": self.used, "limit": self.limit,
                "retry_after_s": self.retry_after_s, "reset_at": reset, "message": msg}


def limits() -> dict[str, int]:
    s = settings()
    return {"chat": s.limit_chat_per_day, "run": s.limit_run_per_day, "route": s.limit_route_per_day, "report": s.limit_report_per_day, "burst_per_min": s.limit_burst_per_min}


def _today() -> tuple[str, int]:
    """(YYYYMMDD in the usage timezone, seconds until the next local midnight)."""
    now = datetime.now(ZoneInfo(settings().usage_timezone))
    nxt = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return now.strftime("%Y%m%d"), int((nxt - now).total_seconds())


def _client():
    if _fs["broken"] or settings().geo_backend != "ee":      # mock/local: memory only, no cloud calls
        return None
    if _fs["client"] is None:
        try:
            from google.cloud import firestore
            _fs["client"] = firestore.Client(project=settings().project_id or settings().ee_project or None)
        except Exception as e:  # noqa: BLE001
            log.warning("usage counters: Firestore unavailable (%s); using per-instance memory", str(e)[:100])
            _fs["broken"] = True
    return _fs["client"]


def _bump_firestore(db, uid: str, day: str, kind: str, limit: int, reset_s: int) -> tuple[bool, int]:
    from google.cloud import firestore
    ref = db.collection("usage").document(f"{uid}_{day}")

    @firestore.transactional
    def txn(t):
        cur = ((ref.get(transaction=t).to_dict()) or {}).get(kind, 0)
        if cur >= limit:
            return False, cur
        t.set(ref, {kind: cur + 1, "uid": uid, "day": day, "expires_at": datetime.now().astimezone() + timedelta(seconds=reset_s + 2 * 86400)}, merge=True)
        return True, cur + 1

    return txn(db.transaction())


def _bump_memory(uid: str, day: str, kind: str, limit: int) -> tuple[bool, int]:
    with _lock:
        c = _mem[(uid, day)]
        cur = c.get(kind, 0)
        if cur >= limit:
            return False, cur
        c[kind] = cur + 1
        return True, cur + 1


def consume(uid: str, kind: str) -> Result:
    """Count one request. Burst limit first (cheap, in memory), then the daily counter for 'chat'/'run'."""
    s = settings()
    now = time.time()
    with _lock:
        q = _burst[uid]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= s.limit_burst_per_min:
            return Result(False, "burst_limit", len(q), s.limit_burst_per_min, int(60 - (now - q[0])) + 1)
        q.append(now)
    if kind not in ("chat", "run", "route", "report"):
        return Result(True)
    limit = limits()[kind]
    day, reset_s = _today()
    db = _client()
    ok, used = False, 0
    if db is not None:
        try:
            ok, used = _bump_firestore(db, uid, day, kind, limit, reset_s)
        except Exception as e:  # noqa: BLE001 - never lock users out because the counter store failed
            log.warning("usage counters: Firestore error (%s); falling back to memory", str(e)[:120])
            ok, used = _bump_memory(uid, day, kind, limit)
    else:
        ok, used = _bump_memory(uid, day, kind, limit)
    if not ok:
        with _lock:                      # a refused request must not eat burst budget
            if _burst[uid]:
                _burst[uid].pop()
        return Result(False, "daily_limit", used, limit, reset_s)
    return Result(True, used=used, limit=limit)


def snapshot(uid: str) -> dict:
    """Used/limit per kind for today (read-only)."""
    day, reset_s = _today()
    lim = limits()
    used = {"chat": 0, "run": 0, "route": 0, "report": 0}
    db = _client()
    if db is not None:
        try:
            used.update({k: v for k, v in (db.collection("usage").document(f"{uid}_{day}").get().to_dict() or {}).items() if k in used})
        except Exception:  # noqa: BLE001
            used.update(_mem.get((uid, day), {}))
    else:
        used.update(_mem.get((uid, day), {}))
    return {"day": day, "resets_in_s": reset_s, "chat": {"used": used["chat"], "limit": lim["chat"]}, "run": {"used": used["run"], "limit": lim["run"]}}


def reset_for_tests() -> None:
    with _lock:
        _mem.clear()
        _burst.clear()
