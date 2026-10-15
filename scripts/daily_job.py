"""The daily job (Cloud Run job `dnext-rain`, started by Cloud Scheduler twice a day):
  1. refresh the rainfall file (scripts/precompute_rain.py) and upload it to the bucket
  2. append the new day to BigQuery (province and tambon history)
  3. publish a Pub/Sub message so the API can send alerts for provinces that got riskier
Step 1 decides the exit code. Steps 2 and 3 only log a warning when they fail: the fresh data must not be lost because of them.

  cd apps/api && uv run python ../../scripts/daily_job.py --bucket <project>-dnext
"""
import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common as c  # noqa: E402
import precompute_rain  # noqa: E402


def main(argv=None) -> int:
    c.setup_logging()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--bucket", default="")
    p.add_argument("--skip-rain", action="store_true", help="only run steps 2 and 3 on the file that is already in place")
    a = p.parse_args(argv)
    if not a.skip_rain:
        rc = precompute_rain.main(["--bucket", a.bucket] if a.bucket else [])
        if rc:
            return rc
    from app import alerts, history
    from app.geo import obs_cache, overview
    obs_cache.reset()
    try:
        series = overview.series(5, fresh=True)
    except Exception as e:  # noqa: BLE001
        c.log.warning("history and alerts skipped: %s", e)
        return 0
    try:
        overview.save_series(series, a.bucket)   # the API reads this instead of computing the 5-day overview itself
    except Exception as e:  # noqa: BLE001
        c.log.warning("overview file not saved: %s", str(e)[:200])
    run_time = datetime.now(timezone.utc)
    try:
        snap = overview.tambon_snapshot(0)
        written = history.write_snapshot(series, history.tambon_history_rows(snap, series["date_of_data"], run_time), run_time)
        c.log.info("BigQuery: %s", written or "not configured")
    except Exception as e:  # noqa: BLE001
        c.log.warning("BigQuery step failed: %s", str(e)[:200])
    mid = alerts.publish_new_data(series["date_of_data"], series.get("model_run_time"))
    c.log.info("Pub/Sub message: %s", mid or "not published")
    return 0


if __name__ == "__main__":
    sys.exit(main())
