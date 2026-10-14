"""Blob storage for briefings: gs://$PROJECT_ID-dnext/briefings/. No-op locally (writes ./.local_storage)."""
import logging
from pathlib import Path

from app.settings import settings

log = logging.getLogger("storage")
LOCAL_DIR = Path(".local_storage")


def _local(name: str, data: bytes) -> str:
    p = LOCAL_DIR / "briefings" / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    return str(p)


def upload(name: str, content: str | bytes, content_type: str = "text/markdown; charset=utf-8") -> str:
    """Store content under briefings/<name>; returns a gs:// URI (private, not a public URL) or local path.
    Never raises."""
    data = content.encode("utf-8") if isinstance(content, str) else content
    name = Path(name).name  # no path traversal
    s = settings()
    try:
        if s.geo_backend == "mock" or not s.project_id:
            return _local(name, data)
        from google.cloud import storage
        bucket = f"{s.project_id}-dnext"
        storage.Client(project=s.project_id).bucket(bucket).blob(f"briefings/{name}") \
            .upload_from_string(data, content_type=content_type)
        return f"gs://{bucket}/briefings/{name}"
    except Exception as e:
        log.warning("GCS upload failed, writing locally: %s", e)
        try:
            return _local(name, data)
        except Exception as e2:
            log.warning("local write failed: %s", e2)
            return ""
