"""Alerts when a watched province gets riskier: Pub/Sub message from the daily job -> this module -> in-app notifications (and optional email).

Firestore:  watchlists/{account}                     {provinces, min_class, email, address, lang}
            alerts/{account}/items/{id}              one notification (deleted after 30 days)
            alert_state/provinces                    the highest risk class per province at the last run, to see what changed
Pub/Sub:    topic `dnext-new-data` (published by the job), push subscription -> POST /internal/new-data (OIDC token checked here)."""
import base64
import hashlib
import json
import logging
import smtplib
import threading
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

from app.settings import settings

log = logging.getLogger(__name__)
WATCH = "watchlists"
ALERTS = "alerts"
ITEMS = "items"
STATE_DOC = ("alert_state", "provinces")
MAX_WATCHED = 10
ALERT_TTL_DAYS = 30
CLASS_NAMES = {"en": ["Very low", "Low", "Moderate", "High", "Very high"], "th": ["ต่ำมาก", "ต่ำ", "ปานกลาง", "สูง", "สูงมาก"]}
_lock = threading.Lock()
_mem: dict = {"watch": {}, "alerts": {}, "state": None}
_fs = {"client": None, "broken": False}


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
        log.warning("Firestore unavailable, alerts are kept in memory: %s", e)
        return None


def _break(e: Exception) -> None:
    if not _fs["broken"]:
        log.warning("Firestore error, alerts are kept in memory: %s", e)
    _fs.update(client=None, broken=True)


def reset_for_tests() -> None:
    with _lock:
        _mem.update(watch={}, alerts={}, state=None)
    _fs.update(client=None, broken=False)


# ---------------- watch lists
def get_watch(account: str) -> dict:
    c = _client()
    if c is not None:
        try:
            snap = c.collection(WATCH).document(account).get()
            return snap.to_dict() or {} if snap.exists else {}
        except Exception as e:  # noqa: BLE001
            _break(e)
    with _lock:
        return dict(_mem["watch"].get(account, {}))


def set_watch(account: str, provinces: list[str], min_class: int, email: bool, address: str, lang: str) -> dict:
    doc = {"provinces": provinces[:MAX_WATCHED], "min_class": min_class, "email": bool(email and address), "address": address if email else "", "lang": lang}
    with _lock:
        _mem["watch"][account] = doc
    c = _client()
    if c is not None:
        try:
            c.collection(WATCH).document(account).set(doc)
        except Exception as e:  # noqa: BLE001
            _break(e)
    return doc


def watchers_of(pcode: str) -> list[tuple[str, dict]]:
    c = _client()
    if c is not None:
        try:
            return [(s.id, s.to_dict() or {}) for s in c.collection(WATCH).where("provinces", "array_contains", pcode).stream()]
        except Exception as e:  # noqa: BLE001
            _break(e)
    with _lock:
        return [(a, dict(d)) for a, d in _mem["watch"].items() if pcode in d.get("provinces", [])]


# ---------------- notifications
def add_alert(account: str, item: dict) -> bool:
    """Stores one notification; the id makes a repeat of the same event harmless. Returns False when it already existed."""
    aid = hashlib.sha1(f"{item['province_code']}|{item['date']}|{item['class']}".encode()).hexdigest()[:20]
    doc = {**item, "id": aid, "read": False, "created": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    c = _client()
    if c is not None:
        try:
            ref = c.collection(ALERTS).document(account).collection(ITEMS).document(aid)
            if ref.get().exists:
                return False
            ref.set({**doc, "expires_at": datetime.now(timezone.utc) + timedelta(days=ALERT_TTL_DAYS)})
            return True
        except Exception as e:  # noqa: BLE001
            _break(e)
    with _lock:
        rows = _mem["alerts"].setdefault(account, {})
        if aid in rows:
            return False
        rows[aid] = doc
        return True


def list_alerts(account: str, limit: int = 30) -> dict:
    c = _client()
    rows: list[dict] = []
    if c is not None:
        try:
            q = c.collection(ALERTS).document(account).collection(ITEMS).order_by("created", direction="DESCENDING").limit(limit)
            rows = [{k: v for k, v in (s.to_dict() or {}).items() if k != "expires_at"} for s in q.stream()]
            return {"unread": sum(1 for r in rows if not r.get("read")), "items": rows}
        except Exception as e:  # noqa: BLE001
            _break(e)
    with _lock:
        rows = sorted(_mem["alerts"].get(account, {}).values(), key=lambda r: r["created"], reverse=True)[:limit]
    return {"unread": sum(1 for r in rows if not r.get("read")), "items": rows}


def mark_all_read(account: str) -> None:
    c = _client()
    if c is not None:
        try:
            for s in c.collection(ALERTS).document(account).collection(ITEMS).where("read", "==", False).stream():
                s.reference.update({"read": True})
            return
        except Exception as e:  # noqa: BLE001
            _break(e)
    with _lock:
        for r in _mem["alerts"].get(account, {}).values():
            r["read"] = True


# ---------------- what changed
def _get_state() -> dict | None:
    c = _client()
    if c is not None:
        try:
            snap = c.collection(STATE_DOC[0]).document(STATE_DOC[1]).get()
            return snap.to_dict() if snap.exists else None
        except Exception as e:  # noqa: BLE001
            _break(e)
    with _lock:
        return _mem["state"]


def _set_state(state: dict) -> None:
    with _lock:
        _mem["state"] = state
    c = _client()
    if c is not None:
        try:
            c.collection(STATE_DOC[0]).document(STATE_DOC[1]).set(state)
        except Exception as e:  # noqa: BLE001
            _break(e)


def peak_classes(series: dict) -> dict[str, dict]:
    """Per province: the highest risk class over today and the forecast days, and the first day that reaches it."""
    out: dict[str, dict] = {}
    for d in series["days"]:
        for p in d["provinces"]:
            cur = out.setdefault(p["pcode"], {"class": 0, "h": 0, "name": p.get("name", ""), "name_th": p.get("name_th", "")})
            if p["risk_class"] > cur["class"]:
                cur.update({"class": p["risk_class"], "h": d["h"]})
    return out


def detect(series: dict, previous: dict | None, min_class: int) -> list[dict]:
    """Provinces whose peak class rose to `min_class` or more since the last run. The first ever run only records the state."""
    if not previous:
        return []
    from datetime import date
    start = date.fromisoformat(series["date_of_data"])
    events = []
    for pc, cur in peak_classes(series).items():
        before = previous.get("classes", {}).get(pc, 0)
        if cur["class"] >= min_class and cur["class"] > before:
            events.append({"province_code": pc, "province": cur["name"], "province_th": cur["name_th"], "class": cur["class"], "from_class": before,
                           "horizon": cur["h"], "date": (start + timedelta(days=cur["h"])).isoformat()})
    return events


def message(ev: dict, lang: str) -> tuple[str, str]:
    th = lang == "th"
    cls = CLASS_NAMES["th" if th else "en"][max(0, min(ev["class"], 5) - 1)]
    area = (ev.get("province_th") or ev["province"]) if th else ev["province"]
    when = ("วันนี้" if th else "today") if ev["horizon"] == 0 else (f"ภายใน {ev['horizon']} วัน" if th else f"within {ev['horizon']} days")
    title = f"{area}: ความเสี่ยงดินถล่มระดับ{cls}" if th else f"{area}: landslide risk reaches {cls}"
    body = (f"ตามข้อมูลล่าสุด ความเสี่ยงสูงสุดในจังหวัดนี้ถึงระดับ{cls} {when} นี่เป็นการประเมินเบื้องต้นเพื่อการวางแผน ไม่ใช่คำเตือน"
            if th else f"Latest data puts the peak risk in this province at {cls} {when}. This is a screening estimate for planning, not a warning.")
    return title, body


def process_new_data(series: dict) -> dict:
    """Compare the new series with the stored state, notify the watchers of provinces that got riskier, store the new state."""
    key = {"date_of_data": series["date_of_data"], "model_run": series.get("model_run_time")}
    state = _get_state()
    if state and state.get("date_of_data") == key["date_of_data"] and state.get("model_run") == key["model_run"]:
        return {"skipped": True, "reason": "already processed"}
    sent = notified = 0
    for ev in detect(series, state, min_class=2):
        for account, w in watchers_of(ev["province_code"]):
            if ev["class"] < int(w.get("min_class", settings().alert_min_class)):
                continue
            title, body = message(ev, w.get("lang", "en"))
            if add_alert(account, {**ev, "title": title, "body": body}):
                notified += 1
                if w.get("email") and w.get("address") and send_email(w["address"], title, body):
                    sent += 1
    _set_state({**key, "classes": {pc: v["class"] for pc, v in peak_classes(series).items()}, "updated": datetime.now(timezone.utc).isoformat(timespec="seconds")})
    return {"skipped": False, "notified": notified, "emails": sent}


def send_email(to: str, subject: str, body: str) -> bool:
    s = settings()
    if not (s.smtp_host and s.smtp_from):
        return False
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = s.smtp_from, to, subject
    msg.set_content(f"{body}\n\n-- DNext (landslide risk screening). You get this because you chose to be notified for this province. Turn it off in the app.")
    try:
        with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=20) as smtp:
            smtp.starttls()
            if s.smtp_user:
                smtp.login(s.smtp_user, s.smtp_password)
            smtp.send_message(msg)
        return True
    except Exception as e:  # noqa: BLE001
        log.warning("alert email failed: %s", str(e)[:120])
        return False


# ---------------- Pub/Sub
def publish_new_data(date_of_data: str, model_run: str | None) -> str | None:
    """Tell the API that fresh data is in the bucket. Returns the message id, or None when Pub/Sub is not configured."""
    s = settings()
    project = s.project_id or s.ee_project
    if not project or s.geo_backend == "mock":
        return None
    try:
        from google.cloud import pubsub_v1
        pub = pubsub_v1.PublisherClient()
        fut = pub.publish(pub.topic_path(project, s.pubsub_topic), json.dumps({"date_of_data": date_of_data, "model_run": model_run}).encode(),
                          date_of_data=date_of_data)
        return fut.result(timeout=30)
    except Exception as e:  # noqa: BLE001
        log.warning("Pub/Sub publish failed: %s", str(e)[:160])
        return None


def verify_push(authorization: str | None) -> bool:
    """The push subscription sends a Google-signed OIDC token: check the signature, the audience (our URL) and the sender."""
    s = settings()
    if not (s.pubsub_audience and s.pubsub_invoker_sa and authorization and authorization.lower().startswith("bearer ")):
        return False
    try:
        from google.auth.transport import requests as grequests
        from google.oauth2 import id_token
        claim = id_token.verify_oauth2_token(authorization.split(" ", 1)[1], grequests.Request(), audience=s.pubsub_audience)
        return claim.get("email") == s.pubsub_invoker_sa and bool(claim.get("email_verified"))
    except Exception as e:  # noqa: BLE001
        log.info("rejected push token: %s", str(e)[:100])
        return False


def decode_push(body: dict) -> dict:
    data = (body.get("message") or {}).get("data", "")
    try:
        return json.loads(base64.b64decode(data).decode()) if data else {}
    except Exception:  # noqa: BLE001
        return {}
