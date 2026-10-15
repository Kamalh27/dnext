"""Daily risk history in BigQuery: the daily job appends one snapshot per run, the API reads the 30-day trend of a province.

Tables in dataset `dnext` (partitioned by `date`):
  province_daily  one row per province, day and horizon (0 = observed, 1..5 = forecast day): risk class, peak risk, tambons above their trigger,
                  people in the elevated zone, mean rain of the day
  tambon_daily    the same per tambon: 30-day rain, trigger class, peak risk, people in the elevated zone
A day can be written more than once (the job runs twice a day); reads take the newest run per day."""
import logging
import threading
import time
from datetime import date, datetime, timedelta, timezone

from app.settings import settings

log = logging.getLogger(__name__)
DATASET = "dnext"
PROVINCE_TABLE = "province_daily"
TAMBON_TABLE = "tambon_daily"
_lock = threading.Lock()
_cache: dict = {}
_TTL_S = 1800
_state = {"client": None, "broken": False}

PROVINCE_SCHEMA = [
    ("date", "DATE"), ("run_time", "TIMESTAMP"), ("horizon", "INT64"), ("province_code", "STRING"), ("province", "STRING"),
    ("risk_class", "INT64"), ("risk_max", "FLOAT64"), ("triggered", "INT64"), ("tambons", "INT64"), ("people_elevated", "INT64"), ("rain_mm", "FLOAT64"),
]
TAMBON_SCHEMA = [
    ("date", "DATE"), ("run_time", "TIMESTAMP"), ("horizon", "INT64"), ("tambon_code", "STRING"), ("province_code", "STRING"),
    ("rain30_mm", "FLOAT64"), ("trigger_class", "INT64"), ("risk_max", "FLOAT64"), ("people_elevated", "INT64"),
]


def _client():
    """BigQuery client, or None when it is not configured (mock backend, no project, no credentials)."""
    if _state["client"] is not None:
        return _state["client"]
    s = settings()
    project = s.project_id or s.ee_project
    if _state["broken"] or s.geo_backend == "mock" or not project:
        return None
    try:
        from google.cloud import bigquery
        _state["client"] = bigquery.Client(project=project, location=s.region)
        return _state["client"]
    except Exception as e:  # noqa: BLE001
        _state["broken"] = True
        log.warning("BigQuery unavailable, no history: %s", e)
        return None


def _fq(client, table: str) -> str:
    return f"{client.project}.{DATASET}.{table}"


def ensure_tables(client) -> None:
    from google.cloud import bigquery
    client.create_dataset(bigquery.Dataset(f"{client.project}.{DATASET}"), exists_ok=True)
    for name, schema in ((PROVINCE_TABLE, PROVINCE_SCHEMA), (TAMBON_TABLE, TAMBON_SCHEMA)):
        t = bigquery.Table(_fq(client, name), schema=[bigquery.SchemaField(n, ty) for n, ty in schema])
        t.time_partitioning = bigquery.TimePartitioning(field="date", expiration_ms=730 * 86_400_000)      # keep two years
        client.create_table(t, exists_ok=True)


def province_rows(series: dict, run_time: datetime) -> list[dict]:
    """Flatten overview.series() into province_daily rows."""
    start = date.fromisoformat(series["date_of_data"])
    rows = []
    for d in series["days"]:
        day = (start + timedelta(days=d["h"])).isoformat()
        for p in d["provinces"]:
            rows.append({"date": day, "run_time": run_time.isoformat(), "horizon": d["h"], "province_code": p["pcode"], "province": p.get("name", ""),
                         "risk_class": p["risk_class"], "risk_max": p["risk_max"], "triggered": p["triggered"], "tambons": p["tambons"],
                         "people_elevated": p["people_elevated"], "rain_mm": p.get("rain_mm")})
    return rows


def tambon_history_rows(snapshot: list[dict], date_of_data: str, run_time: datetime, horizon: int = 0) -> list[dict]:
    """Tag overview.tambon_snapshot() rows with the day, the run and the horizon, ready for tambon_daily."""
    day = (date.fromisoformat(date_of_data) + timedelta(days=horizon)).isoformat()
    return [{"date": day, "run_time": run_time.isoformat(), "horizon": horizon, **r} for r in snapshot]


def write_snapshot(series: dict, tambon_rows: list[dict] | None = None, run_time: datetime | None = None) -> dict:
    """Append one run to BigQuery. Returns what was written, or {} when BigQuery is not available."""
    c = _client()
    if c is None:
        return {}
    from google.cloud import bigquery
    run_time = run_time or datetime.now(timezone.utc)
    ensure_tables(c)
    out = {}
    for table, rows in ((PROVINCE_TABLE, province_rows(series, run_time)), (TAMBON_TABLE, tambon_rows or [])):
        if not rows:
            continue
        cfg = bigquery.LoadJobConfig(write_disposition="WRITE_APPEND", source_format="NEWLINE_DELIMITED_JSON")
        c.load_table_from_json(rows, _fq(c, table), job_config=cfg).result()
        out[table] = len(rows)
    with _lock:
        _cache.clear()
    return out


def trend(pcode: str, days: int = 30) -> dict:
    """Observed daily risk of one province over the last `days` days (newest run per day)."""
    key = (pcode, days)
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < _TTL_S:
            return hit[1]
    c = _client()
    if c is None:
        return {"pcode": pcode, "available": False, "days": []}
    try:
        from google.cloud import bigquery
        q = f"""
            SELECT FORMAT_DATE('%Y-%m-%d', date) AS date, risk_class, risk_max, triggered, tambons, people_elevated, rain_mm
            FROM `{_fq(c, PROVINCE_TABLE)}`
            WHERE province_code = @p AND horizon = 0 AND date >= DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL @n DAY)
            QUALIFY ROW_NUMBER() OVER (PARTITION BY date ORDER BY run_time DESC) = 1
            ORDER BY date"""
        job = c.query(q, job_config=bigquery.QueryJobConfig(query_parameters=[bigquery.ScalarQueryParameter("p", "STRING", pcode),
                                                                              bigquery.ScalarQueryParameter("n", "INT64", days)]))
        rows = [dict(r.items()) for r in job.result()]
        out = {"pcode": pcode, "available": True, "days": rows}
    except Exception as e:  # noqa: BLE001 - the table does not exist before the first run, or no permission
        log.info("trend unavailable: %s", str(e)[:120])
        out = {"pcode": pcode, "available": False, "days": []}
    with _lock:
        _cache[key] = (time.time(), out)
    return out


def reset_for_tests() -> None:
    with _lock:
        _cache.clear()
    _state.update(client=None, broken=False)
