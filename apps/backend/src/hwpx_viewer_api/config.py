"""Application settings. Loaded from env vars (+ .env file in dev)."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Typed env config. Required vars must be set or startup fails."""

    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ---- Claude Code CLI (M2: replaces direct Anthropic API) ----
    # Uses OAuth via `claude auth` — no API key handling on this server.
    claude_cli_path: str = Field(default="claude", alias="CLAUDE_CLI_PATH")
    claude_model: str = Field(default="sonnet", alias="CLAUDE_MODEL")

    # ---- CORS ----
    cors_allowed_origins: str = Field(
        default="http://localhost:5173,http://localhost:8080",
        alias="CORS_ALLOWED_ORIGINS",
    )

    # ---- Upload (M3) ----
    max_upload_mb: int = Field(default=20, alias="MAX_UPLOAD_MB")

    # ---- Logging ----
    log_level: str = Field(default="info", alias="LOG_LEVEL")

    # ---- Streaming ----
    stream_max_tokens: int = Field(default=4000, alias="STREAM_MAX_TOKENS")
    once_max_tokens: int = Field(default=1500, alias="ONCE_MAX_TOKENS")

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_allowed_origins.split(",") if o.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
