"""FastAPI app entrypoint."""

from __future__ import annotations

import logging

import structlog
from fastapi import FastAPI

from . import __version__
from .config import get_settings
from .routes import claude, download, health, render, upload
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
        description="Backend for the HWPX Viewer. Exposes Claude proxy (M2). "
        "HWPX I/O + rhwp rendering endpoints will be added in M3R~M7R.",
    )

    install_cors(app, settings)

    app.include_router(health.router)
    app.include_router(claude.router)
    # M3R — rhwp-backed rendering + I/O.
    app.include_router(upload.router)
    app.include_router(render.router)
    app.include_router(download.router)
    # /api/hit-test + /api/edit land in M5R / M6R respectively.

    return app


app = create_app()
