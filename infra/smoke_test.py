#!/usr/bin/env python3
"""Deployed-API smoke test (stdlib only).  Usage: python infra/smoke_test.py https://api-url [--budget 20]"""
import json
import sys
import time
import urllib.request

BUDGET = 20.0
RESULTS: list[tuple[str, bool, str]] = []


def record(name, ok, detail=""):
    RESULTS.append((name, ok, detail))


def post(url, body, timeout):
    req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json"})
    return urllib.request.urlopen(req, timeout=timeout)


def check_health(base):
    try:
        with urllib.request.urlopen(base + "/healthz", timeout=10) as r:
            record("GET /healthz", r.status == 200, f"HTTP {r.status}")
    except Exception as e:
        record("GET /healthz", False, str(e))


def check_scenario(base):
    t0 = time.time()
    try:
        with post(base + "/scenario", {"area": "Nan", "rainfall_mm": 250, "duration_h": 72}, 60) as r:
            data = json.load(r)
        dt = time.time() - t0
        missing = [k for k in ("map_layer", "kpis", "chart") if k not in data]
        kp = data.get("kpis", {})
        missing += [f"kpis.{k}" for k in ("people", "households_est", "buildings", "road_km", "data_sources", "limitations") if k not in kp]
        missing += [f"map_layer.{k}" for k in ("tile_url", "legend") if k not in data.get("map_layer", {})]
        record("POST /scenario keys", not missing, "missing: " + ", ".join(missing) if missing else "ok")
        record(f"POST /scenario < {BUDGET:.0f}s", dt < BUDGET, f"{dt:.1f}s")
    except Exception as e:
        record("POST /scenario", False, str(e))


def check_chat(base):
    events, t0 = [], time.time()
    try:
        with post(base + "/chat", {"message": "250 mm of rain in 3 days in Nan - what is the risk?",
                                   "session_id": f"smoke-{int(t0)}", "language": "en"}, 120) as r:
            ev = None
            for raw in r:
                line = raw.decode("utf-8").rstrip("\r\n")
                if line.startswith("event:"):
                    ev = line[6:].strip()
                elif line.startswith("data:") and ev:
                    events.append(ev)
                    if ev in ("final", "error"):
                        break
        kinds = set(events)
        record("POST /chat reaches final", "final" in kinds, f"{len(events)} events in {time.time() - t0:.1f}s")
        record("/chat has kpis event", "kpis" in kinds, "")
        record("/chat has text_delta", "text_delta" in kinds, "")
        record("/chat no error event", "error" not in kinds, "")
    except Exception as e:
        record("POST /chat", False, str(e))


def main():
    global BUDGET
    args = [a for a in sys.argv[1:]]
    if "--budget" in args:
        i = args.index("--budget")
        BUDGET = float(args[i + 1])
        del args[i:i + 2]
    if not args:
        sys.exit(__doc__)
    base = args[0].rstrip("/")
    check_health(base)
    check_scenario(base)
    check_chat(base)
    w = max(len(n) for n, _, _ in RESULTS)
    print(f"\n{'CHECK'.ljust(w)}  RESULT  DETAIL")
    for n, ok, d in RESULTS:
        print(f"{n.ljust(w)}  {'PASS' if ok else 'FAIL'}    {d}")
    failed = [n for n, ok, _ in RESULTS if not ok]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
