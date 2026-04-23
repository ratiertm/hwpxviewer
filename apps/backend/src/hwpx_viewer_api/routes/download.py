"""GET /api/download/{uploadId} — return the edited document bytes.

Design v0.3 §4.2.

HWPX round-trip status (M3R): rhwp only exposes ``exportHwp`` (HWP 5.x binary).
True HWPX save requires the pyhwpxlib ``json_io.patch`` replay path on the
preserved original bytes — scheduled for M4R. Until then this endpoint returns
HWP 5.x so users can at least verify edits in Hancom Office, with a clear
``X-HwpxViewer-Format`` header signalling the temporary fallback.
"""

from __future__ import annotations

import logging
import urllib.parse

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from ..services.upload_store import get_upload_store

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/download/{upload_id}")
async def download(upload_id: str) -> Response:
    store = get_upload_store()
    entry = store.get(upload_id)
    if entry is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "UPLOAD_EXPIRED",
                    "message": "업로드 세션이 만료되었습니다.",
                    "recoverable": True,
                }
            },
        )

    try:
        data = entry.session.export_hwp_bytes()
    except Exception as e:  # noqa: BLE001
        logger.exception("download.export_failed", extra={"upload_id": upload_id})
        raise HTTPException(
            status_code=500,
            detail={
                "error": {
                    "code": "CONVERTER_ERROR",
                    "message": "문서 저장 중 문제가 생겼습니다.",
                    "detail": str(e)[:500],
                    "recoverable": False,
                }
            },
        ) from e

    # Temporary: we export HWP 5.x until M4R adds true HWPX round-trip.
    stem = entry.file_name.rsplit(".", 1)[0] or "document"
    out_name = f"{stem} (수정본).hwp"
    quoted = urllib.parse.quote(out_name)

    return Response(
        content=data,
        media_type="application/x-hwp",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quoted}",
            "X-HwpxViewer-Format": "hwp-5-temporary",  # surfaces M3R limitation
        },
    )

