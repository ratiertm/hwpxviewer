"""POST /api/save — write the edited HWPX directly to a known folder.

The "Save" button avoids browser-download ambiguity (Cache-Control, accumulated
``(1).hwpx`` copies in ~/Downloads, viewer apps still holding the old file
open). Backend writes to ``~/Documents/HwpxViewer/`` with a deterministic
filename, returns the absolute path. Frontend shows a toast with the path and
a "Finder 에서 보기" action.

Companion route ``POST /api/reveal`` opens the folder in Finder/Explorer
without needing the user to copy/paste the path.

Local-only: this route assumes the backend runs on the user's machine
(it writes to the user's home dir). Production deploys must keep this off.
"""

from __future__ import annotations

import logging
import platform
import re
import subprocess
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services.upload_store import get_upload_store

logger = logging.getLogger(__name__)
router = APIRouter()


# Where saved files live. Hard-coded for v1 — could become a setting later.
SAVE_DIR = Path.home() / "Documents" / "HwpxViewer"


# Characters macOS / Linux file systems dislike or that surprise users.
_FORBIDDEN_FILENAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _sanitize_filename(name: str) -> str:
    cleaned = _FORBIDDEN_FILENAME_CHARS.sub("_", name).strip()
    return cleaned or "document"


class SaveRequest(BaseModel):
    uploadId: str
    overwrite: bool = False  # if True, overwrites an existing file with same name


class SaveResponse(BaseModel):
    path: str
    fileName: str
    fileSize: int
    version: int
    edits: int


@router.post("/api/save", response_model=SaveResponse)
async def save(req: SaveRequest) -> SaveResponse:
    store = get_upload_store()
    entry = store.get(req.uploadId)
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
        logger.exception("save.bytes_failed", extra={"upload_id": req.uploadId})
        raise HTTPException(
            status_code=500,
            detail={
                "error": {
                    "code": "CONVERTER_ERROR",
                    "message": "문서 변환 중 문제가 발생했습니다.",
                    "detail": str(e)[:500],
                    "recoverable": False,
                }
            },
        ) from e

    SAVE_DIR.mkdir(parents=True, exist_ok=True)

    live_edits = [e for e in entry.session.edits if not e["undone"]]
    edit_n = len(live_edits)
    version = int(entry.session.version)

    stem = entry.file_name.rsplit(".", 1)[0] or "document"
    base = f"{stem} v{version}-{edit_n}편집.hwpx"
    base = _sanitize_filename(base)
    out_path = SAVE_DIR / base

    # Avoid silent overwrites unless the caller asked for it. If a file with
    # the same v/edits already exists (e.g., the user clicked Save twice
    # without making any change), append a numeric suffix.
    if out_path.exists() and not req.overwrite:
        i = 1
        stem_no_ext = base[: -len(".hwpx")]
        while True:
            candidate = SAVE_DIR / f"{stem_no_ext} ({i}).hwpx"
            if not candidate.exists():
                out_path = candidate
                break
            i += 1
            if i > 100:
                break

    out_path.write_bytes(data)
    logger.info(
        "save.written",
        extra={"path": str(out_path), "size": len(data), "version": version, "edits": edit_n},
    )

    return SaveResponse(
        path=str(out_path),
        fileName=out_path.name,
        fileSize=len(data),
        version=version,
        edits=edit_n,
    )


# ---------------------------------------------------------------------------
# Reveal in Finder / Explorer
# ---------------------------------------------------------------------------


class RevealRequest(BaseModel):
    path: str = Field(min_length=1)


class RevealResponse(BaseModel):
    ok: bool


@router.post("/api/reveal", response_model=RevealResponse)
async def reveal(req: RevealRequest) -> RevealResponse:
    """Open the parent folder of ``path`` and select the file.

    Local-only convenience. Restricts ``path`` to the SAVE_DIR tree so an
    attacker can't trick the backend into running ``open -R /etc/passwd``.
    """
    target = Path(req.path).resolve()
    try:
        target.relative_to(SAVE_DIR.resolve())
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "PATH_FORBIDDEN",
                    "message": "허용되지 않은 경로입니다.",
                    "recoverable": False,
                }
            },
        ) from e

    if not target.exists():
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "PATH_NOT_FOUND",
                    "message": "파일을 찾을 수 없습니다.",
                    "recoverable": True,
                }
            },
        )

    system = platform.system()
    try:
        if system == "Darwin":
            subprocess.run(["open", "-R", str(target)], check=False, timeout=5)
        elif system == "Windows":
            subprocess.run(["explorer", f"/select,{target}"], check=False, timeout=5)
        else:  # Linux + others — best effort
            subprocess.run(["xdg-open", str(target.parent)], check=False, timeout=5)
    except Exception as e:  # noqa: BLE001
        logger.warning("reveal.failed", extra={"path": str(target), "error": str(e)})
        return RevealResponse(ok=False)

    return RevealResponse(ok=True)
