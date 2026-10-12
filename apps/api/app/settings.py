from functools import lru_cache
from pathlib import Path

import yaml
from pydantic_settings import BaseSettings, SettingsConfigDict

CONFIG_DIR = Path(__file__).parent / "config"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    project_id: str = ""
    region: str = "asia-southeast1"
    ee_project: str = ""
    geo_backend: str = "mock"
    agent_model: str = "gemini-3.5-flash"
    briefing_model: str = "gemini-3.5-flash"
    allowed_origins: str = "http://localhost:3000"
    max_request_bytes: int = 16_384
    rate_limit: str = "30/minute"


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
