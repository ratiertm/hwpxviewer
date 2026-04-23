"""POST /api/upload — accept an .hwpx, load via rhwp WASM, return session info.

Design v0.3 §4.2. Minimal validation for M3R/M4R: extension + magic bytes
(`PK\\x03\\x04` ZIP header) + size ceiling. More rigorous checks (MIME sniff,
encrypted/corrupt detection) land in M4R `security/upload_validate.py`.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, File, HTTPException, UploadFile

from ..config import get_settings
from ..schemas import DocumentInfo, UploadResponse
from ..services.rhwp_wasm import get_engine
from ..services.upload_store import get_upload_store

logger = logging.getLogger(__name__)
router = APIRouter()


_HWPX_MAGIC = b"PK\x03\x04"
_ALLOWED_EXTENSIONS = (".hwpx", ".hwp")  # rhwp supports both


@router.post("/api/upload", response_model=UploadResponse)
async def upload(file: UploadFile = File(...)) -> UploadResponse:
    settings = get_settings()
    max_bytes = settings.max_upload_mb * 1024 * 1024

    # 1) Extension whitelist.
    name = (file.filename or "upload.hwpx").strip()
    if not name.lower().endswith(_ALLOWED_EXTENSIONS):
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "INVALID_FILE",
                    "message": ".hwpx 파일만 업로드할 수 있습니다.",
                    "recoverable": True,
                }
            },
        )

    # 2) Read into memory (MVP: single shot; streaming is M8).
    data = await file.read()
    size = len(data)

    if size > max_bytes:
        raise HTTPException(
            status_code=413,
            detail={
                "error": {
                    "code": "FILE_TOO_LARGE",
                    "message": f"파일이 너무 큽니다(최대 {settings.max_upload_mb}MB).",
                    "recoverable": True,
                }
            },
        )

    # 3) Magic bytes — HWPX is a ZIP container.
    if name.lower().endswith(".hwpx") and not data.startswith(_HWPX_MAGIC):
        raise HTTPException(
            status_code=415,
            detail={
                "error": {
                    "code": "UNSUPPORTED_FORMAT",
                    "message": "이 파일은 열 수 없습니다 (손상되었거나 형식이 올바르지 않습니다).",
                    "recoverable": True,
                }
            },
        )

    # 4) Hand off to rhwp.
    try:
        engine = get_engine()
        session = engine.load_document_bytes(data, name=name)
    except Exception as e:  # noqa: BLE001 — wrap anything the WASM throws
        logger.exception("upload.load_failed", extra={"file": name})
        raise HTTPException(
            status_code=500,
            detail={
                "error": {
                    "code": "CONVERTER_ERROR",
                    "message": "문서 변환 중 문제가 생겼습니다.",
                    "detail": str(e)[:500],
                    "recoverable": False,
                }
            },
        ) from e

    # 5) Persist session + return metadata.
    upload_id = get_upload_store().put(session=session, file_name=name, file_size=size)

    return UploadResponse(
        document=DocumentInfo(
            uploadId=upload_id,
            fileName=name,
            fileSize=size,
            pageCount=session.page_count,
            version=0,
        )
    )
