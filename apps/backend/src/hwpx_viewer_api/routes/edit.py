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
    ParagraphInsertRequest,
    ParagraphInsertResponse,
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


@router.post("/api/paragraphs/insert", response_model=ParagraphInsertResponse)
async def insert_paragraph(req: ParagraphInsertRequest) -> ParagraphInsertResponse:
    """Insert a placeholder paragraph adjacent to ``(sec, para)``.

    Phase 2.6 (E): adds a fresh ``<hp:p>`` so users can populate empty regions
    without an existing text anchor. The placeholder is regular editable text —
    re-selecting it goes through the normal edit/undo pipeline. The insert
    itself is also reversible via ``/api/undo``.
    """
    entry = _entry_or_404(req.uploadId)
    session = entry.session

    cell = None
    if req.cell is not None:
        cell = {
            "parentParaIndex": req.cell.parentParaIndex,
            "controlIndex": req.cell.controlIndex,
            "cellIndex": req.cell.cellIndex,
        }

    try:
        edit_entry = session.insert_paragraph(
            sec=req.sec,
            anchor_para=req.para,
            position=req.position,
            placeholder=req.placeholder,
            cell=cell,
        )
    except Exception as e:  # noqa: BLE001
        logger.exception(
            "paragraph_insert.failed",
            extra={
                "upload_id": req.uploadId,
                "sec": req.sec,
                "para": req.para,
                "position": req.position,
            },
        )
        raise HTTPException(
            status_code=500,
            detail={
                "error": {
                    "code": "PARAGRAPH_INSERT_ERROR",
                    "message": "단락 삽입에 실패했습니다.",
                    "detail": str(e)[:500],
                    "recoverable": False,
                }
            },
        ) from e

    return ParagraphInsertResponse(
        editId=int(edit_entry["id"]),
        document=_doc_info(entry),
        affectedPages=list(range(session.page_count)),
        newPara=int(edit_entry["para"]),
        placeholder=str(edit_entry.get("placeholder", "")),
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
