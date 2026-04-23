"""POST /api/export — edited Block pages → regenerated .hwpx bytes."""

from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends
from fastapi.responses import Response

from ..schemas import ExportRequest
from ..services.hwpx_service import export_hwpx
from ..services.upload_store import UploadStore, get_upload_store

router = APIRouter(prefix="/api", tags=["hwpx"])


def _get_store() -> UploadStore:
    return get_upload_store()


@router.post("/export")
async def export_endpoint(
    req: ExportRequest,
    store: UploadStore = Depends(_get_store),
) -> Response:
    result = export_hwpx(pages=list(req.pages), upload_id=req.uploadId, store=store)
    # RFC 5987 encode the filename for non-ASCII (e.g., Korean) names.
    filename_ascii = "edited.hwpx"
    filename_encoded = quote(result.download_name, safe="")
    headers = {
        "Content-Disposition": (
            f'attachment; filename="{filename_ascii}"; '
            f"filename*=UTF-8''{filename_encoded}"
        )
    }
    if not result.passthrough_available:
        headers["X-HwpxViewer-Passthrough"] = "missing"
    return Response(
        content=result.bytes_payload,
        media_type="application/vnd.hancom.hwpx",
        headers=headers,
    )
