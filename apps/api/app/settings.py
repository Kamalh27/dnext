from functools import lru_cache
from pathlib import Path

import yaml
from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

load_dotenv()  # export .env to os.environ (e.g. GOOGLE_MAPS_SERVER_KEY read by areas.py)
CONFIG_DIR = Path(__file__).parent / "config"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    project_id: str = ""
    region: str = "asia-southeast1"
    ee_project: str = ""
    ee_service_account_key: str = ""   # local dev: path to SA JSON; empty = ADC / attached SA
    geo_backend: str = "mock"
    agent_model: str = "gemini-3.5-flash"
    briefing_model: str = ""   # empty = deterministic template only (no LLM polish)
    allowed_origins: str = "http://localhost:3000"
    max_request_bytes: int = 16_384
    rate_limit: str = "30/minute"
    request_timeout_s: float = 60.0


@lru_cache
def settings() -> Settings:
    return Settings()


@lru_cache
def load_yaml(name: str) -> dict:
    return yaml.safe_load((CONFIG_DIR / name).read_text())


@lru_cache
def assets() -> dict:
    """datasets.yaml merged with assets.local.yaml (written by scripts/ after each export).
    This is the single 'plug-in' point: once scripts finish, asset IDs land here and the API uses them."""
    merged = dict(load_yaml("datasets.yaml"))
    local = CONFIG_DIR / "assets.local.yaml"
    if local.exists():
        merged.update({k: v for k, v in (yaml.safe_load(local.read_text()) or {}).items() if v})
    return merged


_PARENTS = Path(__file__).resolve().parents
REPO_ROOT = _PARENTS[min(3, len(_PARENTS) - 1)]   # repo root locally; '/' in the container (/app/app/settings.py)


def service_account_key_path() -> Path | None:
    """Resolved SA key path from EE_SERVICE_ACCOUNT_KEY, or None. Relative paths resolve against the repo root."""
    raw = settings().ee_service_account_key.strip()
    if not raw:
        return None
    p = Path(raw).expanduser()
    p = p if p.is_absolute() else REPO_ROOT / p
    if not p.is_file():
        raise FileNotFoundError(f"EE_SERVICE_ACCOUNT_KEY points to {p}, which does not exist")
    return p


def _export_adc_from_key() -> None:
    """If a key is configured, make Vertex/Firestore/GCS clients use it too (one identity locally)."""
    import os
    key = service_account_key_path() if settings().ee_service_account_key.strip() else None
    if key and not os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(key)


_export_adc_from_key()
