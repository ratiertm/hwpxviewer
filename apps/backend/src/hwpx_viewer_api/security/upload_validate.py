"""Upload validation — file name / extension / magic bytes / size.

HWPX is a ZIP container (OPC-like) so the first four bytes must match
``PK\\x03\\x04``.
"""

from __future__ import annotations

from ..errors import app_error

HWPX_MAGIC = b"PK\x03\x04"
ALLOWED_EXTENSIONS = (".hwpx",)
ALLOWED_MIME_TYPES = (
    "application/vnd.hancom.hwpx",
    "application/octet-stream",
    "application/zip",
    "",  # some browsers omit MIME
)


def validate_upload(
    *, file_name: str, content_type: str | None, payload: bytes, max_upload_mb: int
) -> None:
    """Raise an :class:`HTTPException` with mapped AppError code if invalid."""
    if not file_name:
        raise app_error("INVALID_FILE", detail="empty file name")

    lower = file_name.lower()
    if not lower.endswith(ALLOWED_EXTENSIONS):
        raise app_error("INVALID_FILE", detail=f"extension={_ext(lower)}")

    if content_type is not None and content_type.lower() not in ALLOWED_MIME_TYPES:
        raise app_error("INVALID_FILE", detail=f"content-type={content_type}")

    size_bytes = len(payload)
    max_bytes = max_upload_mb * 1024 * 1024
    if size_bytes > max_bytes:
        raise app_error(
            "FILE_TOO_LARGE",
            detail=f"size={size_bytes}B max={max_bytes}B",
            message_override=f"파일이 너무 큽니다 (최대 {max_upload_mb}MB).",
        )

    if len(payload) < 4 or not payload.startswith(HWPX_MAGIC):
        raise app_error(
            "UNSUPPORTED_FORMAT",
            detail=f"magic={payload[:4].hex() if payload else 'empty'}",
        )


def _ext(name: str) -> str:
    idx = name.rfind(".")
    return name[idx:] if idx >= 0 else "(none)"
