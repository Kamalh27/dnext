"""Place resolution. Day-1: small built-in province table (centroid+bbox); ADM1-3 asset + Geocoding API replace it later."""
from dataclasses import dataclass, asdict

from rapidfuzz import fuzz, process

# name_en, name_th, pcode, (w, s, e, n)
_PROVINCES = [
    ("Mae Hong Son", "แม่ฮ่องสอน", "TH58", (97.35, 17.35, 98.60, 19.80)),
    ("Chiang Mai", "เชียงใหม่", "TH50", (98.00, 17.15, 99.65, 20.10)),
    ("Chiang Rai", "เชียงราย", "TH57", (99.05, 19.10, 100.60, 20.45)),
    ("Nan", "น่าน", "TH55", (100.40, 18.10, 101.40, 19.65)),
    ("Phetchabun", "เพชรบูรณ์", "TH67", (100.70, 15.60, 101.45, 17.30)),
    ("Nakhon Si Thammarat", "นครศรีธรรมราช", "TH80", (99.10, 7.90, 100.30, 9.20)),
    ("Surat Thani", "สุราษฎร์ธานี", "TH84", (98.40, 8.30, 100.00, 9.60)),
]
_NAMES = {n.lower(): p for p in _PROVINCES for n in (p[0], p[1])}


@dataclass
class Area:
    name: str
    name_th: str
    admin_code: str
    bbox: list[float]  # w,s,e,n

    def dict(self):
        return asdict(self)


class AreaError(ValueError):
    pass


def resolve(query: str) -> Area:
    q = query.strip().lower()
    if not q:
        raise AreaError("Empty place name")
    hit = process.extractOne(q, list(_NAMES), scorer=fuzz.WRatio, score_cutoff=82)
    if not hit:
        raise AreaError(
            f"'{query}' not found among supported Thai provinces "
            f"({', '.join(p[0] for p in _PROVINCES)}). Is it outside Thailand?"
        )
    n, _, pcode, bbox = _NAMES[hit[0]]  # type: ignore[misc]
    p = _NAMES[hit[0]]
    return Area(name=p[0], name_th=p[1], admin_code=p[2], bbox=list(p[3]))
