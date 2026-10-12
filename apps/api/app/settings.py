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
