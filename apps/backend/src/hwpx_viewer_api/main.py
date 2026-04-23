"""FastAPI app entrypoint."""

from __future__ import annotations

import logging

import structlog
from fastapi import FastAPI

from . import __version__
from .config import get_settings
from .routes import claude, export, health, import_
from .security.cors import install_cors


def _configure_logging(level: str) -> None:
    logging.basicConfig(level=level.upper())
    structlog.configure(
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
    )


def create_app() -> FastAPI:
    settings = get_settings()
    _configure_logging(settings.log_level)

    app = FastAPI(
        title="HWPX Viewer API",
        version=__version__,
        description="Backend for the HWPX Viewer. Exposes Claude proxy (M2) and "
        "HWPX import/export (M3).",
    )

    install_cors(app, settings)

    app.include_router(health.router)
    app.include_router(claude.router)
    app.include_router(import_.router)
    app.include_router(export.router)

    return app


app = create_app()
