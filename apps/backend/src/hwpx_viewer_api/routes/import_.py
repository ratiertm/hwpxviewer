"""POST /api/import — multipart .hwpx upload → Block pages + DocumentMeta."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, UploadFile

from ..config import Settings, get_settings
from ..errors import app_error
from ..schemas import ImportResponse
from ..security.upload_validate import validate_upload
from ..services.hwpx_service import import_hwpx
from ..services.upload_store import UploadStore, get_upload_store

router = APIRouter(prefix="/api", tags=["hwpx"])


def _get_store() -> UploadStore:
    return get_upload_store()


@router.post("/import", response_model=ImportResponse)
async def import_endpoint(
    file: UploadFile = File(...),
    settings: Settings = Depends(get_settings),
    store: UploadStore = Depends(_get_store),
) -> ImportResponse:
    try:
        payload = await file.read()
    except Exception as e:
        raise app_error("INVALID_FILE", detail=f"read failed: {e}") from e

    validate_upload(
        file_name=file.filename or "",
        content_type=file.content_type,
        payload=payload,
        max_upload_mb=settings.max_upload_mb,
    )

    result = import_hwpx(
        file_name=file.filename or "uploaded.hwpx",
        payload=payload,
        store=store,
    )
    return ImportResponse(pages=result.pages, meta=result.meta)
