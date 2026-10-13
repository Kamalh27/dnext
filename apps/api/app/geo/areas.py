"""Place resolution: Thai provinces / amphoe / tambon -> Area.

Resolution order
1. Offline admin index  app/config/admin_index.json  (written by scripts/upload_admin.py; list of
   {level, pcode, name_en, name_th, bbox, parent_pcode}). Exact then rapidfuzz fuzzy match, Thai + English,
   'amphoe/อำเภอ/ตำบล/จังหวัด' prefixes stripped (and used as a level hint), province wins ties,
   ambiguous names raise AreaError(candidates=[...]) so the agent can ask ONE clarifying question.
2. Built-in table of all 77 provinces (approximate boxes, ``approx=True``) when the index file is absent.
3. Optional Google Geocoding API (needs GOOGLE_MAPS_SERVER_KEY); anything not in Thailand is rejected.
Public API (stable): resolve(query) -> Area, Area.dict(), AreaError.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import asdict, dataclass, field
from functools import lru_cache
from pathlib import Path

from rapidfuzz import fuzz, process

from app.settings import CONFIG_DIR

FUZZY_CUTOFF = 84
TIE_MARGIN = 3.0
_LEVELS = ("province", "amphoe", "tambon")


@dataclass
class Area:
    name: str
    name_th: str
    admin_code: str
    bbox: list[float]  # w,s,e,n
    level: str = "province"  # province | amphoe | tambon
    pcode: str = ""
    parent: str | None = None  # parent admin unit name (EN)
    geometry: dict | None = None  # GeoJSON, optional
    approx: bool = False  # bbox is approximate

    def dict(self):
        return asdict(self)


class AreaError(ValueError):
    def __init__(self, message: str, candidates: list[dict] | None = None):
        super().__init__(message)
        self.candidates = candidates or []


# ---------------------------------------------------------------- built-in table (all 77 provinces)
# name_en, name_th, pcode, centre lat, centre lon, half-height deg, half-width deg
_P = [
    ("Bangkok", "กรุงเทพมหานคร", "TH10", 13.75, 100.60, .22, .25),
    ("Samut Prakan", "สมุทรปราการ", "TH11", 13.60, 100.75, .20, .18),
    ("Nonthaburi", "นนทบุรี", "TH12", 13.88, 100.40, .10, .12),
    ("Pathum Thani", "ปทุมธานี", "TH13", 14.05, 100.57, .15, .20),
    ("Phra Nakhon Si Ayutthaya", "พระนครศรีอยุธยา", "TH14", 14.35, 100.57, .25, .25),
    ("Ang Thong", "อ่างทอง", "TH15", 14.60, 100.40, .15, .15),
    ("Lop Buri", "ลพบุรี", "TH16", 15.00, 101.00, .50, .50),
    ("Sing Buri", "สิงห์บุรี", "TH17", 14.88, 100.40, .15, .15),
    ("Chai Nat", "ชัยนาท", "TH18", 15.18, 100.12, .30, .25),
    ("Saraburi", "สระบุรี", "TH19", 14.65, 101.05, .35, .45),
    ("Chon Buri", "ชลบุรี", "TH20", 13.10, 101.25, .50, .45),
    ("Rayong", "ระยอง", "TH21", 12.90, 101.55, .30, .35),
    ("Chanthaburi", "จันทบุรี", "TH22", 12.75, 102.15, .45, .45),
    ("Trat", "ตราด", "TH23", 12.05, 102.65, .45, .35),
    ("Chachoengsao", "ฉะเชิงเทรา", "TH24", 13.60, 101.50, .40, .40),
    ("Prachin Buri", "ปราจีนบุรี", "TH25", 14.15, 101.60, .40, .40),
    ("Nakhon Nayok", "นครนายก", "TH26", 14.20, 101.20, .20, .30),
    ("Sa Kaeo", "สระแก้ว", "TH27", 13.80, 102.25, .45, .45),
    ("Nakhon Ratchasima", "นครราชสีมา", "TH30", 15.00, 102.05, .90, .85),
    ("Buri Ram", "บุรีรัมย์", "TH31", 14.70, 102.85, .60, .65),
    ("Surin", "สุรินทร์", "TH32", 14.75, 103.65, .45, .55),
    ("Si Sa Ket", "ศรีสะเกษ", "TH33", 14.75, 104.40, .55, .50),
    ("Ubon Ratchathani", "อุบลราชธานี", "TH34", 15.10, 105.00, .90, .65),
    ("Yasothon", "ยโสธร", "TH35", 15.80, 104.30, .40, .30),
    ("Chaiyaphum", "ชัยภูมิ", "TH36", 15.95, 102.00, .65, .60),
    ("Amnat Charoen", "อำนาจเจริญ", "TH37", 15.90, 104.70, .30, .30),
    ("Bueng Kan", "บึงกาฬ", "TH38", 18.15, 103.65, .40, .45),
    ("Nong Bua Lam Phu", "หนองบัวลำภู", "TH39", 17.20, 102.40, .40, .30),
    ("Khon Kaen", "ขอนแก่น", "TH40", 16.45, 102.55, .60, .75),
    ("Udon Thani", "อุดรธานี", "TH41", 17.40, 102.80, .60, .70),
    ("Loei", "เลย", "TH42", 17.35, 101.45, .65, .60),
    ("Nong Khai", "หนองคาย", "TH43", 17.90, 102.40, .30, .65),
    ("Maha Sarakham", "มหาสารคาม", "TH44", 16.00, 103.30, .30, .50),
    ("Roi Et", "ร้อยเอ็ด", "TH45", 15.90, 103.80, .50, .50),
    ("Kalasin", "กาฬสินธุ์", "TH46", 16.60, 103.55, .45, .55),
    ("Sakon Nakhon", "สกลนคร", "TH47", 17.20, 104.00, .55, .65),
    ("Nakhon Phanom", "นครพนม", "TH48", 17.40, 104.55, .60, .40),
    ("Mukdahan", "มุกดาหาร", "TH49", 16.50, 104.50, .40, .30),
    ("Chiang Mai", "เชียงใหม่", "TH50", 18.63, 98.83, 1.48, .85),
    ("Lamphun", "ลำพูน", "TH51", 18.40, 98.95, .30, .30),
    ("Lampang", "ลำปาง", "TH52", 18.30, 99.50, .75, .60),
    ("Uttaradit", "อุตรดิตถ์", "TH53", 17.70, 100.50, .50, .60),
    ("Phrae", "แพร่", "TH54", 18.20, 100.10, .60, .40),
    ("Nan", "น่าน", "TH55", 18.88, 100.90, .78, .50),
    ("Phayao", "พะเยา", "TH56", 19.25, 100.10, .45, .40),
    ("Chiang Rai", "เชียงราย", "TH57", 19.78, 99.83, .68, .78),
    ("Mae Hong Son", "แม่ฮ่องสอน", "TH58", 18.58, 97.98, 1.22, .62),
    ("Nakhon Sawan", "นครสวรรค์", "TH60", 15.65, 100.10, .55, .70),
    ("Uthai Thani", "อุทัยธานี", "TH61", 15.40, 99.50, .50, .50),
    ("Kamphaeng Phet", "กำแพงเพชร", "TH62", 16.40, 99.55, .60, .55),
    ("Tak", "ตาก", "TH63", 16.75, 98.55, 1.00, .85),
    ("Sukhothai", "สุโขทัย", "TH64", 17.25, 99.65, .45, .50),
    ("Phitsanulok", "พิษณุโลก", "TH65", 16.90, 100.50, .60, .60),
    ("Phichit", "พิจิตร", "TH66", 16.20, 100.30, .30, .30),
    ("Phetchabun", "เพชรบูรณ์", "TH67", 16.45, 101.08, .85, .38),
    ("Ratchaburi", "ราชบุรี", "TH70", 13.50, 99.50, .50, .55),
    ("Kanchanaburi", "กาญจนบุรี", "TH71", 14.50, 98.90, .95, .70),
    ("Suphan Buri", "สุพรรณบุรี", "TH72", 14.50, 100.00, .40, .40),
    ("Nakhon Pathom", "นครปฐม", "TH73", 13.80, 100.00, .20, .25),
    ("Samut Sakhon", "สมุทรสาคร", "TH74", 13.50, 100.20, .15, .20),
    ("Samut Songkhram", "สมุทรสงคราม", "TH75", 13.40, 99.98, .10, .10),
    ("Phetchaburi", "เพชรบุรี", "TH76", 12.95, 99.75, .65, .45),
    ("Prachuap Khiri Khan", "ประจวบคีรีขันธ์", "TH77", 11.75, 99.70, .85, .45),
    ("Nakhon Si Thammarat", "นครศรีธรรมราช", "TH80", 8.55, 99.70, .65, .60),
    ("Krabi", "กระบี่", "TH81", 8.20, 98.95, .45, .40),
    ("Phang Nga", "พังงา", "TH82", 8.80, 98.55, .60, .35),
    ("Phuket", "ภูเก็ต", "TH83", 7.95, 98.38, .15, .15),
    ("Surat Thani", "สุราษฎร์ธานี", "TH84", 9.00, 99.20, .70, .80),
    ("Ranong", "ระนอง", "TH85", 9.85, 98.70, .65, .35),
    ("Chumphon", "ชุมพร", "TH86", 10.50, 99.10, .55, .40),
    ("Songkhla", "สงขลา", "TH90", 7.00, 100.60, .55, .45),
    ("Satun", "สตูล", "TH91", 6.70, 100.00, .35, .45),
    ("Trang", "ตรัง", "TH92", 7.50, 99.55, .50, .40),
    ("Phatthalung", "พัทลุง", "TH93", 7.60, 100.00, .40, .30),
    ("Pattani", "ปัตตานี", "TH94", 6.80, 101.30, .30, .30),
    ("Yala", "ยะลา", "TH95", 6.35, 101.20, .55, .40),
    ("Narathiwat", "นราธิวาส", "TH96", 6.10, 101.80, .50, .45),
]
# Hand-set boxes for the demo provinces (w, s, e, n); the rest use centre +/- half extents.
_BBOX_OVERRIDE = {
    "TH58": (97.35, 17.35, 98.60, 19.80), "TH50": (98.00, 17.15, 99.65, 20.10),
    "TH57": (99.05, 19.10, 100.60, 20.45), "TH55": (100.40, 18.10, 101.40, 19.65),
    "TH67": (100.70, 15.60, 101.45, 17.30), "TH80": (99.10, 7.90, 100.30, 9.20),
    "TH84": (98.40, 8.30, 100.00, 9.60),
}
_ALIASES = {
    "TH10": ["Krung Thep", "Krung Thep Maha Nakhon", "Bangkok Metropolis", "BKK"],
    "TH14": ["Ayutthaya", "Phra Nakhon Si Ayutthaya"],
    "TH16": ["Lopburi"], "TH31": ["Buriram"], "TH33": ["Sisaket"], "TH34": ["Ubon"],
    "TH30": ["Korat", "Khorat"], "TH40": ["Khon Kaen"], "TH46": ["Kalasin"],
    "TH77": ["Prachuap"], "TH80": ["Nakhon Sri Thammarat", "Nakorn Si Thammarat"],
    "TH84": ["Surat"], "TH65": ["Phitsanulok"], "TH93": ["Phatthalung", "Patthalung"],
    "TH38": ["Buengkan"], "TH19": ["Saraburi"], "TH82": ["Phangnga", "Phang-nga"],
}


def _builtin_entries() -> list[dict]:
    out = []
    for en, th, pc, lat, lon, dlat, dlon in _P:
        bb = _BBOX_OVERRIDE.get(pc) or (lon - dlon, lat - dlat, lon + dlon, lat + dlat)
        out.append({"level": "province", "pcode": pc, "name_en": en, "name_th": th,
                    "bbox": [round(x, 3) for x in bb], "parent_pcode": None,
                    "aliases": _ALIASES.get(pc, []), "approx": True})
    return out


# ---------------------------------------------------------------- index loading
def _index_path() -> Path:
    return CONFIG_DIR / "admin_index.json"


@lru_cache(maxsize=4)
def _load_index(path: str, mtime: float) -> list[dict]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    rows = [r for r in raw if r.get("level") in _LEVELS and r.get("bbox") and r.get("pcode")]
    for r in rows:
        r.setdefault("name_en", "")
        r.setdefault("name_th", "")
        r.setdefault("parent_pcode", None)
        r.setdefault("aliases", [])
        r["approx"] = False
    return rows


def _entries() -> list[dict]:
    p = _index_path()
    try:
        if p.exists():
            rows = _load_index(str(p), p.stat().st_mtime)
            if rows:
                return rows
    except (OSError, ValueError):
        pass
    return _builtin_entries()


# ---------------------------------------------------------------- normalisation
_EN_PREFIX = re.compile(r"^(amphoe|amphur|amphoe muang|ampoe|amper|tambon|tambol|tumbon|tambun|"
                        r"changwat|province|district|sub-?district|tessaban)\b\.?\s*", re.I)
_EN_SUFFIX = re.compile(r"\s+(district|sub-?district|province|amphoe|tambon)$", re.I)
_TH_PREFIX = re.compile(r"^(อำเภอ|อ\.|ตำบล|ต\.|จังหวัด|จ\.)\s*")
_EN_HINT = {"amphoe": "amphoe", "amphur": "amphoe", "ampoe": "amphoe", "amper": "amphoe", "district": "amphoe",
            "tambon": "tambon", "tambol": "tambon", "tumbon": "tambon", "tambun": "tambon",
            "subdistrict": "tambon", "sub-district": "tambon", "changwat": "province", "province": "province"}
_TH_HINT = {"อำเภอ": "amphoe", "อ.": "amphoe", "ตำบล": "tambon", "ต.": "tambon",
            "จังหวัด": "province", "จ.": "province"}


def _clean(s: str) -> str:
    s = re.sub(r"[\"'`()]", "", s)
    s = re.sub(r"[-_.]", " ", s) if not re.search(r"[฀-๿]", s) else s
    return re.sub(r"\s+", " ", s).strip().lower()


def _strip(q: str) -> tuple[str, str | None]:
    """Return (normalised name, level hint)."""
    q = q.strip()
    hint = None
    m = _TH_PREFIX.match(q)
    if m:
        hint, q = _TH_HINT[m.group(1)], q[m.end():]
    else:
        m = _EN_PREFIX.match(q)
        if m:
            hint = _EN_HINT.get(m.group(1).lower().replace(" ", ""), None)
            q = q[m.end():]
        m = _EN_SUFFIX.search(q)
        if m:
            hint = hint or _EN_HINT.get(m.group(1).lower())
            q = q[: m.start()]
    return _clean(q), hint


def _names(e: dict) -> list[str]:
    return [n for n in (_clean(e["name_en"]), _clean(e["name_th"]), *[_clean(a) for a in e.get("aliases", [])]) if n]


def _cand(e: dict, by_pcode: dict) -> dict:
    par = by_pcode.get(e.get("parent_pcode") or "")
    return {"name": e["name_en"], "name_th": e["name_th"], "level": e["level"], "pcode": e["pcode"],
            "parent": par["name_en"] if par else None}


def _to_area(e: dict, by_pcode: dict) -> Area:
    par = by_pcode.get(e.get("parent_pcode") or "")
    return Area(name=e["name_en"] or e["name_th"], name_th=e["name_th"], admin_code=e["pcode"],
                bbox=[float(x) for x in e["bbox"]], level=e["level"], pcode=e["pcode"],
                parent=par["name_en"] if par else None, geometry=e.get("geometry"), approx=e.get("approx", False))


def _ancestors(e: dict, by_pcode: dict) -> set[str]:
    out, cur, guard = set(), e, 0
    while cur.get("parent_pcode") and guard < 4:
        cur = by_pcode.get(cur["parent_pcode"])
        if not cur:
            break
        out.update(_names(cur))
        guard += 1
    return out


# ---------------------------------------------------------------- local matching
def _pick(cands: list[dict], by_pcode: dict, query: str) -> Area:
    """cands: matching entries (already same-quality). Province wins; same-level duplicates are ambiguous."""
    for lvl in _LEVELS:  # province > amphoe > tambon
        same = [c for c in cands if c["level"] == lvl]
        if len({c["pcode"] for c in same}) == 1:
            return _to_area(same[0], by_pcode)
        if len(same) > 1:
            cl = [_cand(c, by_pcode) for c in same][:8]
            raise AreaError(f"'{query}' matches {len(cl)} places: "
                            + "; ".join(f"{c['name']} ({c['level']}, {c['parent'] or 'Thailand'})" for c in cl)
                            + ". Ask the user which one they mean.", candidates=cl)
    raise AreaError(f"No match for '{query}'")


def _local(query: str) -> Area | None:
    rows = _entries()
    by_pcode = {r["pcode"]: r for r in rows}
    parts = [p for p in re.split(r"[,/]| in ", query) if p.strip()]
    head, ctx = parts[0], parts[1:]
    name, hint = _strip(head)
    if not name:
        return None
    pool = [r for r in rows if not hint or r["level"] == hint]

    exact = [r for r in pool if name in _names(r)]
    if exact:
        if ctx:  # "Mueang, Nan" -> keep candidates whose ancestors mention the context
            cn = [_strip(c)[0] for c in ctx]
            narrowed = [r for r in exact if any(c in _ancestors(r, by_pcode) for c in cn)]
            exact = narrowed or exact
        return _pick(exact, by_pcode, query)

    if len(name) < 4:
        return None
    flat = [(n, r) for r in pool for n in _names(r)]
    hits = process.extract(name, [n for n, _ in flat], scorer=fuzz.WRatio, score_cutoff=FUZZY_CUTOFF, limit=12)
    if not hits:
        return None
    top = hits[0][1]
    close = {}
    for _, score, idx in hits:
        if score >= top - TIE_MARGIN:
            close[flat[idx][1]["pcode"]] = flat[idx][1]
    return _pick(list(close.values()), by_pcode, query)


# ---------------------------------------------------------------- geocoding fallback
GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"


def _geocode_fetch(params: dict) -> dict:
    import httpx
    r = httpx.get(GEOCODE_URL, params=params, timeout=6.0)
    r.raise_for_status()
    return r.json()


def _geocode(query: str, key: str) -> Area | None:
    lang = "th" if re.search(r"[฀-๿]", query) else "en"
    try:
        data = _geocode_fetch({"address": query, "components": "country:TH", "region": "th",
                               "language": lang, "key": key})
    except Exception as e:  # network / quota: treat as not found, do not crash the agent
        raise AreaError(f"Could not look up '{query}' ({type(e).__name__}).") from e
    results = data.get("results") or []
    if not results:
        return None
    for res in results:
        comps = res.get("address_components", [])
        if not any(c.get("short_name") == "TH" and "country" in c.get("types", []) for c in comps):
            continue
        vp = (res.get("geometry") or {}).get("viewport") or {}
        ne, sw = vp.get("northeast"), vp.get("southwest")
        if not (ne and sw):
            loc = res["geometry"]["location"]
            ne = {"lat": loc["lat"] + .05, "lng": loc["lng"] + .05}
            sw = {"lat": loc["lat"] - .05, "lng": loc["lng"] - .05}
        types = res.get("types", [])
        level = ("province" if "administrative_area_level_1" in types else
                 "amphoe" if "administrative_area_level_2" in types else "tambon")
        name = comps[0]["long_name"] if comps else query
        parent = next((c["long_name"] for c in comps if "administrative_area_level_1" in c.get("types", [])
                       and c["long_name"] != name), None)
        return Area(name=name, name_th=name if lang == "th" else "", admin_code="", bbox=[sw["lng"], sw["lat"], ne["lng"], ne["lat"]],
                    level=level, pcode="", parent=parent, approx=True)
    raise AreaError(f"'{query}' is outside Thailand. LandslideWatch TH only covers Thailand.")


# ---------------------------------------------------------------- public
def resolve(query: str) -> Area:
    q = (query or "").strip()
    if not q:
        raise AreaError("Empty place name")
    if re.fullmatch(r"TH\d{2}(\d{2}(\d{2})?)?", q.upper()):       # exact admin code, e.g. from the province dropdown
        ents = _entries()
        by_pcode = {e["pcode"]: e for e in ents}
        if q.upper() in by_pcode:
            return _to_area(by_pcode[q.upper()], by_pcode)
    area = _local(q)
    if area:
        return area
    key = os.environ.get("GOOGLE_MAPS_SERVER_KEY", "").strip()
    if key:
        area = _geocode(q, key)
        if area:
            return area
    raise AreaError(f"'{query}' was not found in Thailand's province/district/sub-district list. "
                    "It may be outside Thailand, or misspelled.")
