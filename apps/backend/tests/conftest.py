"""Shared pytest fixtures."""

from __future__ import annotations

import os
import tempfile
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from hwpx_viewer_api.config import get_settings
from hwpx_viewer_api.main import create_app
from hwpx_viewer_api.services.upload_store import get_upload_store


@pytest.fixture
def client() -> Iterator[TestClient]:
    get_settings.cache_clear()
    get_upload_store().clear()
    app = create_app()
    with TestClient(app) as c:
        yield c
    get_upload_store().clear()


@pytest.fixture
def sample_hwpx_path() -> Iterator[str]:
    """Generate a small .hwpx on the fly using pyhwpxlib so tests don't
    depend on external fixtures until curated public samples land (M3 #15)."""
    from pyhwpxlib import api

    hx = api.create_document()
    api.add_heading(hx, "사업 계획서", level=1)
    api.add_paragraph(hx, "본 사업은 HWPX 편집 자동화를 목표로 한다.")
    api.add_heading(hx, "예산", level=2)
    api.add_table(
        hx,
        rows=3,
        cols=2,
        data=[["항목", "금액"], ["인건비", "100"], ["기타", "50"]],
    )

    fd, path = tempfile.mkstemp(suffix=".hwpx", prefix="hwpx-fixture-")
    os.close(fd)
    api.save(hx, path)
    try:
        yield path
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


@pytest.fixture
def sample_hwpx_bytes(sample_hwpx_path: str) -> bytes:
    with open(sample_hwpx_path, "rb") as f:
        return f.read()
