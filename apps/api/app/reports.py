"""Community reports: a person photographs a landslide, a blocked road or slope damage and sends it with a place. Gemini looks at the photo,
the data says whether the place could plausibly have a landslide, and the result decides what happens:

  published  the photo shows an event or damage, the AI is at least medium sure and the data does not argue against it -> shown on the map, labelled
             "community report, checked by AI, not verified by authorities", for 48 hours (7 days for slope damage)
  review     unclear or the data disagrees -> kept, not shown
  rejected   not a slope or road scene, looks unrelated or manipulated, or nothing relevant visible -> not kept

The photo is analysed in memory and never stored; the place is rounded to about 100 m. Three flags from different accounts hide a report."""
import hashlib
import logging
import threading
import uuid
from datetime import datetime, timedelta, timezone

from app import photo
from app.settings import settings

log = logging.getLogger(__name__)
COLLECTION = "reports"
TTL = {"landslide": timedelta(hours=48), "road_blocked": timedelta(hours=48), "slope_damage": timedelta(days=7)}
DUPLICATE_M = 300
FLAGS_TO_HIDE = 3
MAX_LISTED = 200
_lock = threading.Lock()
_mem: dict[str, dict] = {}
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
        log.warning("Firestore unavailable, reports are kept in memory: %s", e)
        return None


def _break(e: Exception) -> None:
    if not _fs["broken"]:
        log.warning("Firestore error, reports are kept in memory: %s", e)
    _fs.update(client=None, broken=True)


def reset_for_tests() -> None:
    with _lock:
        _mem.clear()
    _fs.update(client=None, broken=False)


def data_support(lat: float, lng: float) -> dict:
    """What the data says about the place: nearest tambon, whether it has landslide-prone ground and whether its rain is above the rainfall trigger."""
    from app.geo import obs_cache, static_stats
    from app.shelters import distance_m
    data, ss = obs_cache.load(), static_stats.load()
    if not data or not ss:
        return {"level": "unknown", "tambon": None}
    best, best_d = None, 1e12
    for code, t in data["tambon"].items():
        d = (t["lat"] - lat) ** 2 + (t["lon"] - lng) ** 2
        if d < best_d:
            best, best_d = code, d
    if best is None or distance_m(lat, lng, data["tambon"][best]["lat"], data["tambon"][best]["lon"]) > 60_000:
        return {"level": "unknown", "tambon": None}
    prone = best in static_stats.prone_codes(ss)
    t = data["tambon"][best]
    from app.geo import tambon_risk
    d = t["d"][: tambon_risk.cfg()["trigger"]["window_days"]]
    trig = 0 if any(v is None for v in d) else tambon_risk.trigger_class(float(sum(d)), t["thr"])
    level = "strong" if prone and trig >= 1 else "some" if prone else "weak"
    return {"level": level, "tambon": best, "name": t.get("n"), "name_th": t.get("nt"), "province": t.get("p"), "province_th": t.get("pt"), "prone": prone, "trigger_class": trig}


def decide(a: photo.Analysis, support: dict) -> tuple[str, str]:
    """(status, reason) from the AI's reading of the photo and the data."""
    if not a.is_slope_scene:
        return "rejected", "not_slope_scene"
    if a.looks_manipulated_or_unrelated:
        return "rejected", "unrelated_or_manipulated"
    if a.report_kind == "none":
        return "rejected", "nothing_relevant_visible"
    if a.confidence == "low":
        return "review", "low_confidence"
    if support.get("level") == "weak" and a.confidence != "high":
        return "review", "data_disagrees"
    return "published", "ok"


def _expires(kind: str) -> datetime:
    return datetime.now(timezone.utc) + TTL.get(kind, timedelta(hours=48))


def _near_duplicate(kind: str, lat: float, lng: float) -> dict | None:
    from app.shelters import distance_m
    now = datetime.now(timezone.utc)
    for r in _published(None):
        if r["kind"] == kind and distance_m(lat, lng, r["lat"], r["lng"]) <= DUPLICATE_M and r["created_dt"] > now - timedelta(hours=12):
            return r
    return None


def submit(account: str, image_b64: str, lat: float, lng: float, language: str, note: str) -> dict:
    data, mime = photo.decode(image_b64)
    analysis = photo.analyse(data, mime, language, note)
    support = data_support(lat, lng)
    status, reason = decide(analysis, support)
    out = {"status": status, "reason": reason, "kind": analysis.report_kind, "summary": analysis.summary,
           "observations": [o.model_dump() for o in analysis.observations[:3]], "confidence": analysis.confidence, "data_support": support.get("level")}
    if status == "rejected":
        return out
    rlat, rlng = round(lat, 3), round(lng, 3)
    dup = _near_duplicate(analysis.report_kind, rlat, rlng) if status == "published" else None
    if dup:
        _bump_confirmations(dup["id"])
        return {**out, "id": dup["id"], "merged": True}
    rid = uuid.uuid4().hex[:16]
    doc = {"id": rid, "created": datetime.now(timezone.utc).isoformat(timespec="seconds"), "kind": analysis.report_kind, "lat": rlat, "lng": rlng,
           "summary": analysis.summary[:300], "observations": out["observations"], "confidence": analysis.confidence, "data_support": support.get("level"),
           "tambon": support.get("name"), "tambon_th": support.get("name_th"), "province": support.get("province"), "province_th": support.get("province_th"),
           "status": status, "reason": reason, "flags": [], "confirmations": 0, "by": hashlib.sha256(f"report:{account}".encode()).hexdigest()[:16]}
    _save(doc)
    return {**out, "id": rid}


def _save(doc: dict) -> None:
    with _lock:
        _mem[doc["id"]] = doc
    c = _client()
    if c is not None:
        try:
            c.collection(COLLECTION).document(doc["id"]).set({**doc, "expires_at": _expires(doc["kind"])})
        except Exception as e:  # noqa: BLE001
            _break(e)


def _bump_confirmations(rid: str) -> None:
    with _lock:
        if rid in _mem:
            _mem[rid]["confirmations"] = _mem[rid].get("confirmations", 0) + 1
    c = _client()
    if c is not None:
        try:
            from google.cloud import firestore
            c.collection(COLLECTION).document(rid).update({"confirmations": firestore.Increment(1)})
        except Exception as e:  # noqa: BLE001
            _break(e)


def _published(box: tuple[float, float, float, float] | None) -> list[dict]:
    """Visible reports (not expired, published, fewer than FLAGS_TO_HIDE flags), optionally inside (west, south, east, north)."""
    now = datetime.now(timezone.utc)
    c = _client()
    rows: list[dict] = []
    if c is not None:
        try:
            for s in c.collection(COLLECTION).where("status", "==", "published").where("expires_at", ">", now).limit(500).stream():
                rows.append(s.to_dict() or {})
        except Exception as e:  # noqa: BLE001
            _break(e)
            c = None
    if c is None:
        with _lock:
            rows = [dict(r) for r in _mem.values() if r["status"] == "published" and datetime.fromisoformat(r["created"]) + TTL.get(r["kind"], timedelta(hours=48)) > now]
    out = []
    for r in rows:
        if len(r.get("flags", [])) >= FLAGS_TO_HIDE:
            continue
        if box and not (box[0] <= r["lng"] <= box[2] and box[1] <= r["lat"] <= box[3]):
            continue
        r["created_dt"] = datetime.fromisoformat(r["created"])
        out.append(r)
    return out


def listing(box: tuple[float, float, float, float] | None) -> list[dict]:
    rows = sorted(_published(box), key=lambda r: r["created"], reverse=True)[:MAX_LISTED]
    keep = ("id", "created", "kind", "lat", "lng", "summary", "observations", "confidence", "tambon", "tambon_th", "province", "province_th", "confirmations")
    return [{k: r.get(k) for k in keep} for r in rows]


def flag(account: str, rid: str) -> bool:
    """Flag a report as wrong. Returns False when it does not exist. Three different accounts hide it."""
    who = hashlib.sha256(f"flag:{account}".encode()).hexdigest()[:16]
    with _lock:
        r = _mem.get(rid)
        if r is not None and who not in r["flags"]:
            r["flags"].append(who)
    c = _client()
    if c is not None:
        try:
            from google.cloud import firestore
            ref = c.collection(COLLECTION).document(rid)
            snap = ref.get()
            if not snap.exists:
                return False
            ref.update({"flags": firestore.ArrayUnion([who])})
            return True
        except Exception as e:  # noqa: BLE001
            _break(e)
    return r is not None
