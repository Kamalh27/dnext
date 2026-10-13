"""Shared helpers for the one-time data pipeline scripts.

Run from apps/api so `app` imports resolve:  cd apps/api && uv run python ../../scripts/<script>.py
(sys.path handling below also lets them run from anywhere with the api deps installed.)
"""
from __future__ import annotations

import argparse
import logging
import os
import re
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
API_DIR = REPO_ROOT / "apps" / "api"
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

ASSETS_LOCAL = API_DIR / "app" / "config" / "assets.local.yaml"
CONFIG_DIR = API_DIR / "app" / "config"
OUT_DIR = REPO_ROOT / "scripts" / "out"
ASSET_FOLDER_NAME = "landslidewatch"

# Simple rectangle [west, south, east, north]
THAILAND_BBOX = [97.3, 5.6, 105.7, 20.5]
REGION_BBOXES = {
    "bbox": THAILAND_BBOX,
    "nan": [100.2, 17.9, 101.5, 19.7],
    "chiang_rai": [99.1, 19.2, 100.6, 20.5],
    "mae_hong_son": [97.3, 17.7, 98.9, 19.8],
}

log = logging.getLogger("lw")


def setup_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")


def base_parser(description: str) -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=description)
    p.add_argument("--project", default=os.environ.get("EE_PROJECT", ""), help="EE project (env EE_PROJECT)")
    p.add_argument("--dry-run", action="store_true", help="print what would happen; no EE/GCS calls")
    p.add_argument("--overwrite", action="store_true", help="replace the asset if it already exists")
    return p


def require_project(project: str, dry_run: bool) -> str:
    if not project:
        if dry_run:
            return "<EE_PROJECT>"
        sys.exit("EE project required: set EE_PROJECT or pass --project")
    return project


def asset_folder(project: str) -> str:
    return f"projects/{project}/assets/{ASSET_FOLDER_NAME}"


def region_bbox(name: str) -> list[float]:
    if name not in REGION_BBOXES:
        raise ValueError(f"unknown region {name!r}; choose from {sorted(REGION_BBOXES)}")
    return REGION_BBOXES[name]


def thailand_geometry(bbox: list[float] | None = None):
    import ee
    return ee.Geometry.Rectangle(bbox or THAILAND_BBOX, proj="EPSG:4326", geodesic=False)


def ee_init(project: str):
    import ee
    try:   # same credentials as the API: EE_SERVICE_ACCOUNT_KEY file if set, else ADC
        from app.geo import ee_init as app_ee
        app_ee.init()
    except Exception:  # noqa: BLE001 - fall back to plain ADC for the given project
        ee.Initialize(project=project)
    log.info("Earth Engine initialised (project=%s)", project)
    return ee


def asset_exists(asset_id: str) -> bool:
    import ee
    try:
        ee.data.getAsset(asset_id)
        return True
    except ee.EEException:
        return False


def ensure_folder(project: str) -> str:
    """Create projects/<p>/assets/landslidewatch if missing (idempotent)."""
    import ee
    folder = asset_folder(project)
    if not asset_exists(folder):
        ee.data.createAsset({"type": "FOLDER"}, folder)
        log.info("created asset folder %s", folder)
    return folder


def delete_asset_if(asset_id: str, overwrite: bool) -> bool:
    """Returns True if the caller should proceed with writing; False if existing asset should be kept."""
    import ee
    if not asset_exists(asset_id):
        return True
    if not overwrite:
        log.info("asset %s already exists - skipping (use --overwrite to rebuild)", asset_id)
        return False
    ee.data.deleteAsset(asset_id)
    log.info("deleted existing %s", asset_id)
    return True


def wait_for_task_id(task_id: str, timeout: int = 6 * 3600, poll: int = 20) -> dict:
    import ee
    t0 = time.time()
    last = None
    while True:
        st = ee.data.getTaskStatus(task_id)[0]
        state = st.get("state")
        if state != last:
            log.info("task %s: %s", task_id, state)
            last = state
        if state == "COMPLETED":
            return st
        if state in ("FAILED", "CANCELLED", "CANCEL_REQUESTED"):
            raise RuntimeError(f"task {task_id} {state}: {st.get('error_message')}")
        if time.time() - t0 > timeout:
            raise TimeoutError(f"task {task_id} not finished after {timeout}s (state={state})")
        time.sleep(poll)


def start_export_and_wait(task, timeout: int = 6 * 3600, poll: int = 20) -> dict:
    """Start an ee.batch.Export task and poll ee.data.getTaskStatus until it finishes."""
    task.start()
    task_id = task.id
    log.info("started export task %s", task_id)
    return wait_for_task_id(task_id, timeout, poll)


def ingest_table_and_wait(asset_id: str, uris: list[str], extra_source: dict | None = None, timeout: int = 6 * 3600) -> dict:
    """Ingest a table (GeoJSON / zipped shp / CSV) from GCS into an EE FeatureCollection asset."""
    import ee
    source = {"uris": uris, **(extra_source or {})}
    request_id = ee.data.newTaskId(1)[0]
    res = ee.data.startTableIngestion(request_id, {"name": asset_id, "sources": [source]})
    log.info("started table ingestion %s -> %s", res.get("id"), asset_id)
    return wait_for_task_id(res["id"], timeout)


def update_assets_local(key: str, value: str, path: Path | None = None) -> None:
    """Set `key: "value"` in assets.local.yaml, preserving all other keys and comments (line based)."""
    path = path or ASSETS_LOCAL
    text = path.read_text() if path.exists() else ""
    line = f'{key}: "{value}"'
    pattern = re.compile(rf"^{re.escape(key)}\s*:.*$", re.MULTILINE)
    if pattern.search(text):
        text = pattern.sub(lambda _m: line, text, count=1)
    else:
        if text and not text.endswith("\n"):
            text += "\n"
        text += line + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def record_asset(key: str, asset_id: str) -> None:
    update_assets_local(key, asset_id)
    log.info("wrote %s to %s", key, ASSETS_LOCAL)
    print(f"ASSET {key} = {asset_id}")


def today() -> str:
    return time.strftime("%Y-%m-%d")
