"""Security: upload validation tests (magic bytes / extension / size)."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from hwpx_viewer_api.security.upload_validate import HWPX_MAGIC, validate_upload


def test_accepts_valid_hwpx_header() -> None:
    # Should not raise.
    validate_upload(
        file_name="a.hwpx",
        content_type="application/vnd.hancom.hwpx",
        payload=HWPX_MAGIC + b"\x00" * 100,
        max_upload_mb=20,
    )


def test_rejects_wrong_extension() -> None:
    with pytest.raises(HTTPException) as exc:
        validate_upload(
            file_name="a.docx",
            content_type=None,
            payload=HWPX_MAGIC,
            max_upload_mb=20,
        )
    assert exc.value.status_code == 400
    assert exc.value.detail["error"]["code"] == "INVALID_FILE"


def test_rejects_oversize() -> None:
    with pytest.raises(HTTPException) as exc:
        validate_upload(
            file_name="a.hwpx",
            content_type=None,
            payload=HWPX_MAGIC + b"\x00" * (5 * 1024 * 1024),
            max_upload_mb=1,
        )
    assert exc.value.status_code == 413
    assert exc.value.detail["error"]["code"] == "FILE_TOO_LARGE"
    assert "최대 1MB" in exc.value.detail["error"]["message"]


def test_rejects_bad_magic_bytes() -> None:
    with pytest.raises(HTTPException) as exc:
        validate_upload(
            file_name="a.hwpx",
            content_type=None,
            payload=b"NOT_ZIP" + b"\x00" * 50,
            max_upload_mb=20,
        )
    assert exc.value.status_code == 415
    assert exc.value.detail["error"]["code"] == "UNSUPPORTED_FORMAT"


def test_rejects_empty_filename() -> None:
    with pytest.raises(HTTPException) as exc:
        validate_upload(
            file_name="",
            content_type=None,
            payload=HWPX_MAGIC,
            max_upload_mb=20,
        )
    assert exc.value.detail["error"]["code"] == "INVALID_FILE"


def test_rejects_bogus_mime() -> None:
    with pytest.raises(HTTPException) as exc:
        validate_upload(
            file_name="a.hwpx",
            content_type="text/html",
            payload=HWPX_MAGIC,
            max_upload_mb=20,
        )
    assert exc.value.detail["error"]["code"] == "INVALID_FILE"
