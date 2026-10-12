"""Earth Engine initialisation (idempotent). Credential order: EE_SERVICE_ACCOUNT_KEY file (local dev) ->
Application Default Credentials (`gcloud auth application-default login` locally, attached service account on Cloud Run)."""
import logging
import threading
import time

import ee

from app.settings import settings

log = logging.getLogger(__name__)
_SCOPES = ["https://www.googleapis.com/auth/earthengine", "https://www.googleapis.com/auth/cloud-platform"]
_lock = threading.Lock()
_initialised = False


class EEConfigError(RuntimeError):
    pass


def init() -> None:
    global _initialised
    if _initialised:
        return
    with _lock:
        if _initialised:
            return
        from app.settings import service_account_key_path
        key = service_account_key_path()
        project = settings().ee_project
        if not project and key:
            import json
            project = json.loads(key.read_text()).get("project_id", "")  # SA keys carry their project
        if not project:
            raise EEConfigError("EE_PROJECT is not set: Earth Engine backend needs an EE-registered Cloud project "
                                "(set EE_PROJECT in .env) plus Application Default Credentials.")
        if key:
            from google.oauth2 import service_account
            creds = service_account.Credentials.from_service_account_file(str(key), scopes=_SCOPES)
            log.info("Earth Engine using service-account key %s", key.name)
        else:
            import google.auth
            creds, _ = google.auth.default(scopes=_SCOPES)
        ee.Initialize(creds, project=project)
        _initialised = True
        log.info("Earth Engine initialised (project=%s)", project)


_TRANSIENT = ("timed out", "timeout", "deadline", "too many concurrent", "internal error", "unavailable", "429", "503")


def retry(fn, tries: int = 2, delay_s: float = 1.5):
    """Run fn(); retry once on transient EE errors; raise a clear RuntimeError on persistent failure."""
    last: Exception | None = None
    for i in range(tries):
        try:
            return fn()
        except Exception as e:  # ee.EEException, socket/requests timeouts, HttpError
            last = e
            msg = str(e).lower()
            if i + 1 < tries and any(t in msg for t in _TRANSIENT):
                time.sleep(delay_s)
                continue
            break
    msg = str(last).lower()
    if any(t in msg for t in _TRANSIENT):
        raise RuntimeError(f"Earth Engine computation timed out or is overloaded; try a smaller area or retry. ({last})") from last
    raise RuntimeError(f"Earth Engine request failed: {last}") from last


def get_info(obj, tries: int = 2):
    """Single blocking getInfo with retry."""
    init()
    return retry(obj.getInfo, tries=tries)
