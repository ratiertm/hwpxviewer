"""Orchestrates HWPX import / export flows.

Holds the tempfile lifecycle and wires the upload store + converter together
so the routes stay thin.
"""

from __future__ import annotations

import logging
import os
import re
import tempfile
from dataclasses import dataclass

from ..converter import hwpx_to_pages, pages_to_hwpx
from ..converter.blocks_to_overlay import InvalidBlockSequence
from ..errors import app_error
from ..schemas import DocumentMeta, Page
from .upload_store import UploadStore

logger = logging.getLogger(__name__)


@dataclass
class ImportResult:
    pages: list[Page]
    meta: DocumentMeta


@dataclass
class ExportResult:
    bytes_payload: bytes
    download_name: str
    passthrough_available: bool


def import_hwpx(
    *, file_name: str, payload: bytes, store: UploadStore
) -> ImportResult:
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".hwpx", prefix="hwpx-in-")
    try:
        with os.fdopen(tmp_fd, "wb") as f:
            f.write(payload)

        try:
            import uuid

            stub_id = str(uuid.uuid4())
            pages, overlays, doc, meta = hwpx_to_pages(
                tmp_path,
                upload_id=stub_id,
                file_name=file_name,
                file_size=len(payload),
            )
        except Exception as e:  # pyhwpxlib parse failures land here
            logger.exception("hwpx parse failed: %s", e)
            raise app_error(
                "UNSUPPORTED_FORMAT",
                detail=f"{e.__class__.__name__}: {e}",
            ) from e

        upload_id = store.put(
            hwpx_path=tmp_path,
            overlays=overlays,
            doc=doc,
            file_name=file_name,
            file_size=len(payload),
        )
        # Rebind meta with the real uploadId from the store.
        meta = meta.model_copy(update={"uploadId": upload_id})
        return ImportResult(pages=pages, meta=meta)
    except Exception:
        # If anything after fdopen but before store.put failed, clean up.
        if os.path.exists(tmp_path) and not _path_tracked_by_store(tmp_path, store):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
        raise


def export_hwpx(
    *, pages: list[Page], upload_id: str, store: UploadStore
) -> ExportResult:
    entry = store.get(upload_id)
    if entry is None:
        raise app_error("UPLOAD_EXPIRED", detail=f"uploadId={upload_id}")

    out_fd, out_path = tempfile.mkstemp(suffix=".hwpx", prefix="hwpx-out-")
    os.close(out_fd)  # pages_to_hwpx writes via pyhwpxlib
    try:
        try:
            pages_to_hwpx(
                pages,
                source_hwpx_path=entry.hwpx_path,
                original_overlays=entry.overlays,
                original_doc=entry.doc,
                output_path=out_path,
            )
        except InvalidBlockSequence as e:
            raise app_error(
                "CONVERTER_ERROR",
                detail=str(e),
                message_override="편집된 문서 구조가 원본과 달라 저장하지 못했습니다. 블록 추가·삭제·순서 변경은 v1.0에서 지원하지 않습니다.",
            ) from e
        except Exception as e:
            logger.exception("hwpx export failed: %s", e)
            raise app_error("CONVERTER_ERROR", detail=f"{e.__class__.__name__}: {e}") from e

        with open(out_path, "rb") as f:
            blob = f.read()
    finally:
        try:
            os.remove(out_path)
        except OSError:
            pass

    return ExportResult(
        bytes_payload=blob,
        download_name=_edited_name(entry.file_name),
        passthrough_available=True,
    )


def _edited_name(original: str) -> str:
    """Insert ' (수정)' before the .hwpx extension."""
    m = re.match(r"(?P<stem>.+)(?P<ext>\.hwpx)$", original, re.IGNORECASE)
    if m:
        return f"{m.group('stem')} (수정){m.group('ext')}"
    return f"{original} (수정).hwpx"


def _path_tracked_by_store(path: str, store: UploadStore) -> bool:
    # Only used in failure-cleanup. Reach into the internals defensively.
    try:
        with store._lock:  # type: ignore[attr-defined]
            return any(e.hwpx_path == path for e in store._entries.values())  # type: ignore[attr-defined]
    except Exception:
        return False
