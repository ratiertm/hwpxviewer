"""M5R — document coordinate API backed by rhwp WASM.

Endpoints
---------
POST /api/hit-test          screen (page, x, y)            → RunLocation | null
POST /api/selection-rects   Selection                      → [SelectionRect]
POST /api/text-range        Selection                      → text

All three delegate to the live ``DocumentSession`` held in ``upload_store``.
Design v0.3 §4.2.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from ..schemas import (
    CellRef,
    HitTestRequest,
    HitTestResponse,
    ParagraphRequest,
    ParagraphResponse,
    RunLocation,
    SelectionRect,
    SelectionRectsRequest,
    SelectionRectsResponse,
    TextRangeRequest,
    TextRangeResponse,
)


def _cell_dict(selection_or_cell) -> dict | None:
    """Extract CellRef as plain dict for rhwp_wasm (which takes optional dict)."""
    cell = getattr(selection_or_cell, "cell", None) if selection_or_cell is not None else None
    if cell is None:
        return None
    return {
        "parentParaIndex": cell.parentParaIndex,
        "controlIndex": cell.controlIndex,
        "cellIndex": cell.cellIndex,
    }
from ..services.upload_store import get_upload_store

logger = logging.getLogger(__name__)
router = APIRouter()


def _session_or_404(upload_id: str):
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
    return entry.session


@router.post("/api/hit-test", response_model=HitTestResponse)
async def hit_test(req: HitTestRequest) -> HitTestResponse:
    session = _session_or_404(req.uploadId)
    try:
        loc = session.hit_test(req.page, req.x, req.y)
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "hit_test.failed",
            extra={"upload_id": req.uploadId, "page": req.page, "x": req.x, "y": req.y},
        )
        raise HTTPException(status_code=500, detail={"error": {
            "code": "CONVERTER_ERROR",
            "message": "좌표 조회에 실패했습니다.",
            "detail": str(e)[:500],
            "recoverable": False,
        }}) from e
    if loc is None:
        return HitTestResponse(location=None)
    cell_dict = loc.get("cell")
    cell_ref = CellRef(**cell_dict) if cell_dict else None
    return HitTestResponse(
        location=RunLocation(
            sec=int(loc["sec"]),
            para=int(loc["para"]),
            charOffset=int(loc["charOffset"]),
            cell=cell_ref,
        )
    )


@router.post("/api/selection-rects", response_model=SelectionRectsResponse)
async def selection_rects(req: SelectionRectsRequest) -> SelectionRectsResponse:
    session = _session_or_404(req.uploadId)
    start = req.selection.start
    end_offset = start.charOffset + req.selection.length

    try:
        raw = session.get_selection_rects(
            sec=start.sec,
            start_para=start.para,
            start_char_offset=start.charOffset,
            # v0.3: single-run selections only (cross-paragraph handled by
            # chaining multiple Selection calls from the client).
            end_para=start.para,
            end_char_offset=end_offset,
            cell=_cell_dict(start),
        )
    except Exception as e:  # noqa: BLE001
        logger.exception("selection_rects.failed", extra={"upload_id": req.uploadId})
        raise HTTPException(status_code=500, detail={"error": {
            "code": "CONVERTER_ERROR",
            "message": "선택 영역 계산에 실패했습니다.",
            "detail": str(e)[:500],
            "recoverable": False,
        }}) from e

    return SelectionRectsResponse(
        rects=[
            SelectionRect(
                page=int(r["page"]),
                x=float(r["x"]),
                y=float(r["y"]),
                width=float(r["width"]),
                height=float(r["height"]),
            )
            for r in raw
        ]
    )


@router.post("/api/paragraph", response_model=ParagraphResponse)
async def paragraph(req: ParagraphRequest) -> ParagraphResponse:
    """Whole-paragraph info for click-to-select.

    Returns ``length`` (character count) + ``text`` (the full paragraph body).
    The client combines a single hit-test ``(sec, para, _)`` with this to build
    a ``Selection { start: {sec, para, charOffset: 0}, length }`` that spans
    the whole paragraph — used by default-click selection in v0.3.
    """
    session = _session_or_404(req.uploadId)
    cell = _cell_dict(req)
    try:
        length = session.get_paragraph_length(req.sec, req.para, cell=cell)
        text = (
            session.get_text_range(req.sec, req.para, 0, length, cell=cell)
            if length > 0
            else ""
        )
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "paragraph.failed",
            extra={"upload_id": req.uploadId, "sec": req.sec, "para": req.para},
        )
        raise HTTPException(status_code=500, detail={"error": {
            "code": "CONVERTER_ERROR",
            "message": "문단 조회에 실패했습니다.",
            "detail": str(e)[:500],
            "recoverable": False,
        }}) from e
    return ParagraphResponse(length=length, text=text)


@router.post("/api/text-range", response_model=TextRangeResponse)
async def text_range(req: TextRangeRequest) -> TextRangeResponse:
    session = _session_or_404(req.uploadId)
    start = req.selection.start
    try:
        text = session.get_text_range(
            sec=start.sec,
            para=start.para,
            char_offset=start.charOffset,
            count=req.selection.length,
            cell=_cell_dict(start),
        )
    except Exception as e:  # noqa: BLE001
        logger.exception("text_range.failed", extra={"upload_id": req.uploadId})
        raise HTTPException(status_code=500, detail={"error": {
            "code": "CONVERTER_ERROR",
            "message": "텍스트 조회에 실패했습니다.",
            "detail": str(e)[:500],
            "recoverable": False,
        }}) from e
    return TextRangeResponse(text=text)
