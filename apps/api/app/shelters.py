"""Candidate safe places near a point: named shelters, community buildings, schools, temples and hospitals from OpenStreetMap that stand on ground
which stays at Very low risk even at the highest rainfall trigger (scripts/precompute_shelters.py). Not a confirmed list of shelters."""
import json
import logging
import math
import os
import threading
from pathlib import Path

from app.settings import settings

log = logging.getLogger(__name__)
LOCAL = Path(".local_storage/risk/shelters.json")
GCS_BLOB = "risk/shelters.json"
CELL = 0.1                      # degrees (about 11 km) for the lookup grid
_lock = threading.Lock()
_state: dict = {"data": None, "grid": None}


def _read() -> dict | None:
    p = os.environ.get("RISK_SHELTERS_PATH")
    for path in ([Path(p)] if p else []) + [LOCAL]:
        if path.is_file():
            return json.loads(path.read_text())
    project = settings().project_id or settings().ee_project
    if project:
        try:
            from google.cloud import storage
            blob = storage.Client(project=project).bucket(f"{project}-dnext").blob(GCS_BLOB)
            if blob.exists():
                return json.loads(blob.download_as_text())
        except Exception as e:  # noqa: BLE001
            log.info("shelters: GCS not available (%s)", str(e)[:80])
    return None


def load() -> tuple[dict | None, dict]:
    with _lock:
        if _state["data"] is not None:
            return _state["data"], _state["grid"]
    data = _read()
    grid: dict = {}
    if data:
        for i, (_, lat, lng, _, _) in enumerate(data["places"]):
            grid.setdefault((int(lat / CELL), int(lng / CELL)), []).append(i)
        with _lock:
            _state.update(data=data, grid=grid)
    return data, grid


def distance_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2
    return 12_742_000 * math.asin(math.sqrt(a))


def bearing(lat1: float, lng1: float, lat2: float, lng2: float) -> int:
    p1, p2, dl = math.radians(lat1), math.radians(lat2), math.radians(lng2 - lng1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return int((math.degrees(math.atan2(y, x)) + 360) % 360)


def nearest(lat: float, lng: float, k: int = 6, kinds: set[str] | None = None, max_km: float = 60.0) -> list[dict]:
    """The k nearest candidates (optionally of the given kinds) within max_km, nearest first."""
    data, grid = load()
    if not data:
        return []
    places = data["places"]
    cy, cx = int(lat / CELL), int(lng / CELL)
    found: list[tuple[float, int]] = []
    for ring in range(0, int(max_km / (CELL * 111)) + 2):
        for dy in range(-ring, ring + 1):
            for dx in range(-ring, ring + 1):
                if max(abs(dy), abs(dx)) != ring:
                    continue
                for i in grid.get((cy + dy, cx + dx), ()):
                    kind, plat, plng, _, _ = places[i]
                    if kinds and kind not in kinds:
                        continue
                    d = distance_m(lat, lng, plat, plng)
                    if d <= max_km * 1000:
                        found.append((d, i))
        # everything within `ring` cells is covered: stop when k are found and the k-th is closer than the next ring's nearest possible point
        if len(found) >= k:
            found.sort()
            if found[k - 1][0] <= ring * CELL * 111_000 * 0.9:
                break
    found.sort()
    out = []
    for d, i in found[:k]:
        kind, plat, plng, name, name_th = places[i]
        out.append({"kind": kind, "name": name, "name_th": name_th, "lat": plat, "lng": plng, "distance_m": int(round(d)), "bearing": bearing(lat, lng, plat, plng)})
    return out


def reset_for_tests() -> None:
    with _lock:
        _state.update(data=None, grid=None)
