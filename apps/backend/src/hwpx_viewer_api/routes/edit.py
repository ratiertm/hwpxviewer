"""M6R — POST /api/edit, POST /api/undo.

Delegates to DocumentSession.apply_edit / undo_edit (rhwp WASM
insertText/deleteText) and bumps the document version so the client knows
to re-fetch affected pages.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from ..schemas import (
    DocumentInfo,
    EditRequest,
    EditResponse,
    UndoRequest,
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


def _doc_info(entry) -> DocumentInfo:  # type: ignore[no-untyped-def]
    return DocumentInfo(
        uploadId=entry.upload_id,
        fileName=entry.file_name,
        fileSize=entry.file_size,
        pageCount=entry.session.page_count,
        version=entry.session.version,
    )


@router.post("/api/edit", response_model=EditResponse)
async def edit(req: EditRequest) -> EditResponse:
    entry = _entry_or_404(req.uploadId)
    session = entry.session
    start = req.selection.start

    cell = None
    if start.cell is not None:
        cell = {
            "parentParaIndex": start.cell.parentParaIndex,
            "controlIndex": start.cell.controlIndex,
            "cellIndex": start.cell.cellIndex,
        }
    try:
        edit_entry = session.apply_edit(
            sec=start.sec,
            para=start.para,
            char_offset=start.charOffset,
            length=req.selection.length,
            new_text=req.newText,
            cell=cell,
            end_para=(req.selection.end.para if req.selection.end is not None else None),
            end_char_offset=(req.selection.end.charOffset if req.selection.end is not None else None),
        )
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "edit.failed",
            extra={
                "upload_id": req.uploadId,
                "sec": start.sec,
                "para": start.para,
                "offset": start.charOffset,
                "length": req.selection.length,
            },
        )
        raise HTTPException(
            status_code=500,
            detail={
                "error": {
                    "code": "EDIT_ERROR",
                    "message": "편집 적용에 실패했습니다.",
                    "detail": str(e)[:500],
                    "recoverable": False,
                }
            },
        ) from e

    # v0.3: rhwp does not expose a map from paragraph index to page index, so
    # we conservatively tell the client every page may need re-rendering.
    affected = list(range(session.page_count))
    return EditResponse(
        editId=int(edit_entry["id"]),
        document=_doc_info(entry),
        affectedPages=affected,
    )


@router.post("/api/undo", response_model=EditResponse)
async def undo(req: UndoRequest) -> EditResponse:
    entry = _entry_or_404(req.uploadId)
    session = entry.session
    try:
        edit_entry = session.undo_edit(req.editId)
    except KeyError:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "EDIT_NOT_FOUND",
                    "message": "해당 편집을 찾을 수 없습니다.",
                    "recoverable": False,
                }
            },
        )
    except Exception as e:  # noqa: BLE001
        logger.exception("undo.failed", extra={"upload_id": req.uploadId, "edit_id": req.editId})
        raise HTTPException(
            status_code=500,
            detail={
                "error": {
                    "code": "EDIT_ERROR",
                    "message": "편집 되돌리기에 실패했습니다.",
                    "detail": str(e)[:500],
                    "recoverable": False,
                }
            },
        ) from e

    return EditResponse(
        editId=int(edit_entry["id"]),
        document=_doc_info(entry),
        affectedPages=list(range(session.page_count)),
    )
