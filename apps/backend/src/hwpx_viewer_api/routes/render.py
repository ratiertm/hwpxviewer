"""GET /api/render/{uploadId}/{page} — stream a single page as SVG.

Design v0.3 §4.2. Pulls the loaded rhwp document from ``upload_store`` and
returns the page's SVG with ``Content-Type: image/svg+xml``. The SVG is
generated with ``substitute_fonts=True`` so browser renderers can fall back
to installed system Korean fonts even if a specific family is unavailable.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from ..services.upload_store import get_upload_store

logger = logging.getLogger(__name__)
router = APIRouter()


def _upload_expired() -> HTTPException:
    return HTTPException(
        status_code=404,
        detail={
            "error": {
                "code": "UPLOAD_EXPIRED",
                "message": "업로드 세션이 만료되었습니다. 다시 업로드해 주세요.",
                "recoverable": True,
            }
        },
    )


@router.get("/api/render/{upload_id}/{page}")
async def render_page(upload_id: str, page: int) -> Response:
    store = get_upload_store()
    entry = store.get(upload_id)
    if entry is None:
        raise _upload_expired()

    if page < 0 or page >= entry.session.page_count:
        raise HTTPException(
            status_code=416,
            detail={
                "error": {
                    "code": "PAGE_OUT_OF_RANGE",
                    "message": "페이지 범위를 벗어났습니다.",
                    "recoverable": True,
                }
            },
        )

    try:
        # embed_fonts=False — rely on browser's CSS font-family fallback chain
        # (Noto Sans/Serif KR / Apple SD Gothic Neo / Malgun Gothic).
        svg = entry.session.render_page_svg(page, embed_fonts=False)
    except Exception as e:  # noqa: BLE001
        logger.exception("render.failed", extra={"upload_id": upload_id, "page": page})
        raise HTTPException(
            status_code=500,
            detail={
                "error": {
                    "code": "RENDER_ERROR",
                    "message": "페이지 렌더링에 실패했습니다.",
                    "detail": str(e)[:500],
                    "recoverable": False,
                }
            },
        ) from e

    # Cache-friendly: tie the ETag to the version so edits invalidate the
    # browser cache automatically.
    etag = f'W/"v{entry.version}-p{page}"'
    return Response(
        content=svg,
        media_type="image/svg+xml; charset=utf-8",
        headers={"ETag": etag, "Cache-Control": "private, max-age=0, must-revalidate"},
    )
