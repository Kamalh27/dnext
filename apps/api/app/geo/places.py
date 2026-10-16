"""Find a tambon, a district (amphoe) or a province by name in the daily file, for questions such as "how many buildings are at risk in Suthep?".

The province list of areas.resolve() has no districts or tambons, and fuzzy matching sends "Mueang Chiang Mai" to the province, so exact names
are matched here first. A name shared by several places is never guessed: the caller gets the candidates and asks the user.
"""
import re
import threading

from rapidfuzz import fuzz, process

from app.geo import obs_cache

_lock = threading.Lock()
_index: dict = {"sig": None}


class PlaceError(ValueError):
    def __init__(self, message: str, candidates: list[str] | None = None):
        super().__init__(message)
        self.candidates = candidates or []


_WORDS = re.compile(r"\b(tambon|tambol|tumbon|subdistrict|sub-district|sub district|amphoe|amphur|amphoe|district|province|changwat)\b|ตำบล|อำเภอ|จังหวัด|(?<![\w])[ตอจ]\.", re.I)


def norm(s: str) -> str:
    return re.sub(r"[\s\-_'’.]+", "", _WORDS.sub(" ", (s or "").strip().lower()))


def _build(data: dict) -> dict:
    tam, amp, prov = {}, {}, {}
    for code, t in data["tambon"].items():
        rec = {"code": code, "name": t.get("n", ""), "name_th": t.get("nt", ""), "ac": t.get("ac"), "amphoe": t.get("a", ""), "amphoe_th": t.get("at", ""),
               "pc": t.get("pc"), "province": t.get("p", ""), "province_th": t.get("pt", "")}
        for k in (norm(rec["name"]), norm(rec["name_th"])):
            if k:
                tam.setdefault(k, []).append(rec)
        for k in (norm(rec["amphoe"]), norm(rec["amphoe_th"])):
            if k:
                amp.setdefault(k, {}).setdefault(rec["ac"], rec)
        for k in (norm(rec["province"]), norm(rec["province_th"])):
            if k:
                prov.setdefault(k, rec)
    return {"tam": tam, "amp": amp, "prov": prov}


def _idx() -> dict:
    data = obs_cache.load()
    if not data:
        raise PlaceError("The daily rainfall file is not available, so places cannot be looked up right now.")
    sig = (data.get("newest_ms"), len(data["tambon"]))
    with _lock:
        if _index.get("sig") != sig:
            _index.clear()
            _index.update(_build(data), sig=sig)
        return _index


def _label(r: dict) -> str:
    return f"{r['name']} ({r['amphoe']}, {r['province']})"


def find(query: str) -> dict:
    """A tambon or district: {"level", "code", "name", "name_th", "province", "province_th", ...}. Raises PlaceError when there is no match or several."""
    ix = _idx()
    raw = (query or "").strip()
    if not raw:
        raise PlaceError("Empty place name")
    want_tambon = bool(re.search(r"\b(tambon|tambol|tumbon|subdistrict|sub-district)\b|ตำบล|(?<![\w])ต\.", raw, re.I))
    want_amphoe = bool(re.search(r"\b(amphoe|amphur|district)\b|อำเภอ|(?<![\w])อ\.", raw, re.I))
    parts = [norm(p) for p in re.split(r"[,()/;]|\s+in\s+", raw) if norm(p)]
    if not parts:
        raise PlaceError("Empty place name")
    name, quals = parts[0], parts[1:]
    if not quals and name not in ix["tam"] and name not in ix["amp"]:      # "Suthep Chiang Mai": peel a trailing province name off
        for pk in sorted(ix["prov"], key=len, reverse=True):
            if len(name) > len(pk) + 1 and name.endswith(pk):
                name, quals = name[: -len(pk)], [pk]
                break

    def keep_t(r: dict) -> bool:
        return all(q in (norm(r["province"]), norm(r["province_th"]), norm(r["amphoe"]), norm(r["amphoe_th"])) for q in quals)

    tams = [r for r in ix["tam"].get(name, []) if keep_t(r)]
    amps = [r for r in ix["amp"].get(name, {}).values() if all(q in (norm(r["province"]), norm(r["province_th"])) for q in quals)]
    if want_tambon and not want_amphoe:
        amps = []
    if want_amphoe and not want_tambon:
        tams = []
    if amps and (not tams or not want_tambon):
        if len(amps) > 1:
            raise PlaceError(f"Several districts are called '{query}'.", [f"{r['amphoe']} ({r['province']})" for r in amps][:6])
        r = amps[0]
        return {"level": "amphoe", "code": r["ac"], "name": r["amphoe"], "name_th": r["amphoe_th"], "province": r["province"], "province_th": r["province_th"], "pc": r["pc"]}
    if tams:
        if len(tams) > 1:
            raise PlaceError(f"Several tambons are called '{query}'.", [_label(r) for r in tams][:6])
        r = tams[0]
        return {"level": "tambon", "code": r["code"], "name": r["name"], "name_th": r["name_th"], "amphoe": r["amphoe"], "amphoe_th": r["amphoe_th"],
                "province": r["province"], "province_th": r["province_th"], "pc": r["pc"]}
    names = list({k: v for k, v in ix["tam"].items()}.keys())
    near = [m[0] for m in process.extract(name, names, scorer=fuzz.WRatio, limit=3) if m[1] >= 80]
    hint = [_label(ix["tam"][k][0]) for k in near]
    raise PlaceError(f"'{query}' was not found among Thailand's tambons or districts.", hint)


def province_of(query: str) -> dict | None:
    """The province whose name matches exactly (English or Thai), from the same file."""
    rec = _idx()["prov"].get(norm(query))
    return None if not rec else {"level": "province", "code": rec["pc"], "name": rec["province"], "name_th": rec["province_th"]}
