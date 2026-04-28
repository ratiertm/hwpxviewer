"""Page-level routes (Phase 2).

Read endpoints:
  GET /api/pages/{uploadId}        — list page boundaries (sec, paraStart, paraEnd)
  GET /api/pages/{uploadId}/{idx}  — single page detail (boundary + page def)

Phase 2.5 (D) page metadata:
  POST /api/pages/{uploadId}/{idx}/page-def   — set width/height/margins/landscape

Phase 2.4 (B) page CRUD endpoints land in this module too once the lxml
manipulator (services/page_ops.py) is wired up.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.page_boundaries import (
    detect_page_boundaries,
    get_page_def,
    set_page_def,
)
from ..services.upload_store import get_upload_store

logger = logging.getLogger(__name__)
router = APIRouter()


def _entry_or_404(upload_id: str):
    entry = get_upload_store().get(upload_id)
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
    return entry


@router.get("/api/pages/{upload_id}")
async def list_pages(upload_id: str) -> dict:
    """Return all pages with their (sec, paraStart, paraEnd, paragraphCount)."""
    entry = _entry_or_404(upload_id)
    boundaries = detect_page_boundaries(entry.session)
    return {"pages": boundaries, "pageCount": entry.session.page_count}


@router.get("/api/pages/{upload_id}/{page_index}")
async def page_detail(upload_id: str, page_index: int) -> dict:
    """Return a single page's boundary + native page def (HwpUnit)."""
    entry = _entry_or_404(upload_id)
    if page_index < 0 or page_index >= entry.session.page_count:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "PAGE_OUT_OF_RANGE",
                    "message": f"page index {page_index} out of range",
                    "recoverable": False,
                }
            },
        )
    boundaries = detect_page_boundaries(entry.session)
    page = next((b for b in boundaries if b["index"] == page_index), None)
    defn = get_page_def(entry.session, page_index)
    return {"page": page, "pageDef": defn}


# ---------------------------------------------------------------------------
# Phase 2.5 (D) — page metadata setter
# ---------------------------------------------------------------------------


class PageDefUpdate(BaseModel):
    width: int | None = None
    height: int | None = None
    marginLeft: int | None = None
    marginRight: int | None = None
    marginTop: int | None = None
    marginBottom: int | None = None
    marginHeader: int | None = None
    marginFooter: int | None = None
    marginGutter: int | None = None
    landscape: bool | None = None
    binding: int | None = None


@router.post("/api/pages/{upload_id}/{page_index}/page-def")
async def update_page_def(
    upload_id: str,
    page_index: int,
    body: PageDefUpdate,
) -> dict:
    """Update a page's dimensions/margins/orientation.

    HWPX defines these per-section; rhwp's setPageDef applies the change
    to the section containing ``page_index`` (which propagates to all
    pages in that section). For multi-section docs, callers must invoke
    once per affected page.
    """
    entry = _entry_or_404(upload_id)
    session = entry.session
    if page_index < 0 or page_index >= session.page_count:
        raise HTTPException(status_code=400, detail={"error": {"code": "PAGE_OUT_OF_RANGE", "message": "out of range", "recoverable": False}})

    current = get_page_def(session, page_index) or {}
    merged = {**current, **{k: v for k, v in body.model_dump().items() if v is not None}}
    ack = set_page_def(session, page_index, merged)
    if not ack.get("ok", True):
        raise HTTPException(
            status_code=500,
            detail={
                "error": {
                    "code": "PAGE_DEF_FAILED",
                    "message": ack.get("error", "rhwp setPageDef rejected the update"),
                    "detail": str(ack)[:300],
                    "recoverable": False,
                }
            },
        )

    # Bump the session version + invalidate page cache so subsequent
    # /api/render reloads the new layout.
    session.version += 1
    new_def = get_page_def(session, page_index)
    return {
        "ok": True,
        "pageDef": new_def,
        "version": session.version,
        "pageCount": session.page_count,
    }
