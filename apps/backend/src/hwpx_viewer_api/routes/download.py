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
        data = entry.session.save_hwpx_bytes()
    except Exception as e:  # noqa: BLE001
        logger.exception("download.save_failed", extra={"upload_id": upload_id})
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

    # Version + edit count come from the live session, not the upload_store
    # entry (which is set once at put() time). The header values must reflect
    # what's actually in ``data`` so users can spot stale-file confusion.
    live_edits = [e for e in entry.session.edits if not e["undone"]]
    edit_n = len(live_edits)
    version = int(entry.session.version)

    # Suffix the filename with version+edits so the OS treats every download
    # as a distinct file. This sidesteps "Hancom Office still has the old
    # file open" / "Downloads folder kept the old (1).hwpx" confusion.
    stem = entry.file_name.rsplit(".", 1)[0] or "document"
    suffix = f" (수정본 v{version}-{edit_n}편집)"
    out_name = f"{stem}{suffix}.hwpx"
    quoted = urllib.parse.quote(out_name)

    return Response(
        content=data,
        media_type="application/vnd.hancom.hwpx",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quoted}",
            # Prevent the browser from serving a stale post-edit cache when
            # the user downloads after applying further edits.
            "Cache-Control": "no-store, must-revalidate",
            "Pragma": "no-cache",
            # Surface server-side state so the browser/devtools can verify
            # they got the live version, not a cached pre-edit copy.
            "X-HwpxViewer-Version": str(version),
            "X-HwpxViewer-Edits": str(edit_n),
        },
    )

