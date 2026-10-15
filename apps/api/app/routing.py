"""Route preview with the Google Routes API, scored against the risky road sections of a result.

The Routes API cannot be told to avoid an area, so we ask for alternative routes and measure how much of each runs along main-road sections
inside the Moderate-or-higher zone of the result on screen. We only RANK the routes: nothing here says a route is safe.
The call uses the service account's own token (OAuth), so there is no key to restrict or leak. One request per click, cached for 10 minutes."""
import logging
import math
import threading
import time

import httpx

from app.settings import settings

log = logging.getLogger(__name__)
URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
FIELDS = "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline"
THAILAND = (5.4, 20.7, 97.3, 105.8)         # south, north, west, east
NEAR_M = 60.0
_lock = threading.Lock()
_cache: dict = {}
_day = {"key": "", "n": 0}
_TTL_S = 600


def in_thailand(lat: float, lng: float) -> bool:
    return THAILAND[0] <= lat <= THAILAND[1] and THAILAND[2] <= lng <= THAILAND[3]


def decode_polyline(encoded: str) -> list[tuple[float, float]]:
    """Google's encoded polyline -> [(lat, lng), ...]."""
    pts, i, lat, lng = [], 0, 0, 0
    while i < len(encoded):
        for is_lng in (False, True):
            shift = result = 0
            while True:
                b = ord(encoded[i]) - 63
                i += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if is_lng:
                lng += delta
            else:
                lat += delta
        pts.append((lat / 1e5, lng / 1e5))
    return pts


def _densify(path: list[tuple[float, float]], step_m: float = 30.0) -> list[tuple[float, float]]:
    out = [path[0]]
    for (a, b) in zip(path, path[1:]):
        d = math.hypot((b[0] - a[0]) * 110_540, (b[1] - a[1]) * 111_320 * math.cos(math.radians(a[0])))
        n = max(1, int(d // step_m))
        out += [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(1, n + 1)]
    return out


def risk_exposure_km(path: list[tuple[float, float]], risky_roads: list) -> float:
    """Kilometres of the route within NEAR_M of a risky main-road section ([risk, [[lng, lat], ...]] pieces)."""
    if not risky_roads or len(path) < 2:
        return 0.0
    grid: dict = {}
    for _, line in risky_roads:
        for lat, lng in _densify([(y, x) for x, y in line], 20.0):
            grid.setdefault((int(lat / 0.001), int(lng / 0.001)), []).append((lat, lng))
    near = 0
    for lat, lng in _densify(path):
        gy, gx = int(lat / 0.001), int(lng / 0.001)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if any(math.hypot((lat - a) * 110_540, (lng - b) * 111_320 * math.cos(math.radians(lat))) <= NEAR_M for a, b in grid.get((gy + dy, gx + dx), ())):
                    near += 1
                    break
            else:
                continue
            break
    return round(near * 0.03, 2)


def _token() -> str:
    import google.auth
    from google.auth.transport.requests import Request
    creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    creds.refresh(Request())
    return creds.token


def _call_google(origin: tuple[float, float], dest: tuple[float, float], mode: str, alternatives: bool) -> dict:
    s = settings()
    body = {"origin": {"location": {"latLng": {"latitude": origin[0], "longitude": origin[1]}}},
            "destination": {"location": {"latLng": {"latitude": dest[0], "longitude": dest[1]}}},
            "travelMode": mode, "computeAlternativeRoutes": alternatives}
    r = httpx.post(URL, json=body, timeout=20, headers={"Authorization": f"Bearer {_token()}", "X-Goog-User-Project": s.project_id or s.ee_project,
                                                         "X-Goog-FieldMask": FIELDS, "Content-Type": "application/json"})
    r.raise_for_status()
    return r.json()


class RouteUnavailable(RuntimeError):
    pass


def _budget_ok() -> bool:
    """A last-resort cap per instance and day, on top of the per-account limit."""
    key = time.strftime("%Y%m%d")
    with _lock:
        if _day["key"] != key:
            _day.update(key=key, n=0)
        if _day["n"] >= settings().route_daily_cap:
            return False
        _day["n"] += 1
        return True


def routes(origin: tuple[float, float], dest: tuple[float, float], mode: str = "DRIVE", risky_roads: list | None = None) -> list[dict]:
    """Routes from origin to dest, scored and ranked. Raises RouteUnavailable when the Routes API cannot be used."""
    key = (round(origin[0], 4), round(origin[1], 4), round(dest[0], 4), round(dest[1], 4), mode)
    with _lock:
        hit = _cache.get(key)
    if hit and time.time() - hit[0] < _TTL_S:
        raw = hit[1]
    else:
        if not _budget_ok():
            raise RouteUnavailable("The daily limit for route previews has been reached. Open the route in Google Maps instead.")
        try:
            raw = _call_google(origin, dest, mode, True)
        except Exception as e:  # noqa: BLE001
            log.warning("Routes API failed: %s", str(e)[:200])
            raise RouteUnavailable("Route preview is not available right now. Open the route in Google Maps instead.") from e
        with _lock:
            _cache[key] = (time.time(), raw)
    out = []
    for r in raw.get("routes", []):
        enc = (r.get("polyline") or {}).get("encodedPolyline")
        if not enc:
            continue
        path = decode_polyline(enc)
        step = max(1, len(path) // 500)
        out.append({"distance_m": int(r.get("distanceMeters", 0)), "duration_s": int(str(r.get("duration", "0s")).rstrip("s") or 0),
                    "path": [[round(a, 5), round(b, 5)] for a, b in path[::step]] + ([[round(path[-1][0], 5), round(path[-1][1], 5)]] if step > 1 else []),
                    "risk_km": risk_exposure_km(path, risky_roads or []) if risky_roads is not None else None})
    scored = [r for r in out if r["risk_km"] is not None]
    order = sorted(range(len(out)), key=lambda i: (out[i]["risk_km"] if out[i]["risk_km"] is not None else 0, out[i]["duration_s"]))
    for rank, i in enumerate(order):
        out[i]["recommended"] = rank == 0
    for r in out:
        r["flagged"] = bool(scored) and (r["risk_km"] or 0) > 0
    return out


def reset_for_tests() -> None:
    with _lock:
        _cache.clear()
        _day.update(key="", n=0)
