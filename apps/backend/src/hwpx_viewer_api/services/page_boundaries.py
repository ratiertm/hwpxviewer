"""Page boundary detection — foundation for Phase 2 page-level features.

HWPX has no native "page" structural unit. Pages are computed at render
time from (1) explicit ``pageBreak="1"`` markers and (2) content overflow
within configured page dimensions. We therefore ask rhwp's WASM engine
which paragraph each page starts at via ``getPositionOfPage``, and derive
end boundaries from the next page's start (or the section's paragraph
count for the last page).

Output shape::

    [
      {"index": 0, "sec": 0, "paraStart": 0,  "paraEnd": 7,  "paragraphCount": 8},
      {"index": 1, "sec": 0, "paraStart": 8,  "paraEnd": 13, "paragraphCount": 6},
      {"index": 2, "sec": 0, "paraStart": 14, "paraEnd": 19, "paragraphCount": 6},
    ]

This is consumed by:
- Phase 2.2 (C) page multi-select
- Phase 2.3 (A) page AI rewrite
- Phase 2.4 (B) page CRUD
- Phase 2.5 (D) page metadata
"""

from __future__ import annotations

import logging
from typing import Any

from .rhwp_wasm import DocumentSession

logger = logging.getLogger(__name__)


def _get_section_paragraph_count(session: DocumentSession, sec: int) -> int:
    """Return the total paragraph count in section ``sec`` via rhwp WASM."""
    result = session._call_json(
            "hwpdocument_getParagraphCount",
            session._handle,
            sec,
        )
    if isinstance(result, dict):
        return int(result.get("count") or result.get("paragraphCount") or 0)
    if isinstance(result, int):
        return result
    return 0


def _position_of_page(session: DocumentSession, page_index: int) -> dict[str, int] | None:
    """Return the ``(sec, para, charOffset)`` of the first run on ``page_index``."""
    result = session._call_json(
            "hwpdocument_getPositionOfPage",
            session._handle,
            page_index,
        )
    if not isinstance(result, dict) or not result.get("ok", True):
        return None
    return {
        "sec": int(result.get("sec", 0)),
        "para": int(result.get("para", 0)),
        "charOffset": int(result.get("charOffset", 0)),
    }


def detect_page_boundaries(session: DocumentSession) -> list[dict[str, Any]]:
    """Walk every page and return its (sec, paraStart, paraEnd) range."""
    page_count = session.page_count
    if page_count == 0:
        return []

    starts: list[dict[str, int] | None] = [
        _position_of_page(session, i) for i in range(page_count)
    ]
    section_para_counts: dict[int, int] = {}

    boundaries: list[dict[str, Any]] = []
    for i, start in enumerate(starts):
        if start is None:
            logger.warning("page_boundaries.no_position", extra={"page": i})
            continue
        sec = start["sec"]
        para_start = start["para"]

        if i + 1 < page_count and starts[i + 1] is not None:
            next_start = starts[i + 1]
            assert next_start is not None
            if next_start["sec"] == sec:
                para_end = max(para_start, next_start["para"] - 1)
            else:
                if sec not in section_para_counts:
                    section_para_counts[sec] = _get_section_paragraph_count(session, sec)
                para_end = max(para_start, section_para_counts[sec] - 1)
        else:
            if sec not in section_para_counts:
                section_para_counts[sec] = _get_section_paragraph_count(session, sec)
            para_end = max(para_start, section_para_counts[sec] - 1)

        boundaries.append({
            "index": i,
            "sec": sec,
            "paraStart": para_start,
            "paraEnd": para_end,
            "paragraphCount": para_end - para_start + 1,
        })

    return boundaries


def get_page_def(session: DocumentSession, page_index: int) -> dict[str, Any] | None:
    """Return rhwp's native page definition (HwpUnit) — width/height/margins/landscape."""
    result = session._call_json(
            "hwpdocument_getPageDef",
            session._handle,
            page_index,
        )
    if not isinstance(result, dict):
        return None
    return result


def set_page_def(session: DocumentSession, page_index: int, defn: dict[str, Any]) -> dict[str, Any]:
    """Apply a new page definition. Returns rhwp's ack.

    rhwp's ``hwpdocument_setPageDef`` takes the new definition as a
    JSON-encoded string (wasm_bindgen ptr+len convention). Use
    ``_call_json_with_string`` so the dict gets allocated in WASM memory
    properly.
    """
    import json
    payload_keys = (
        "width", "height",
        "marginLeft", "marginRight", "marginTop", "marginBottom",
        "marginHeader", "marginFooter", "marginGutter",
        "landscape", "binding",
    )
    cleaned = {k: defn[k] for k in payload_keys if k in defn}
    payload = json.dumps(cleaned, ensure_ascii=False)
    result = session._call_json_with_string(
        "hwpdocument_setPageDef",
        payload,
        session._handle,
        page_index,
    )
    return result if isinstance(result, dict) else {"ok": bool(result)}


def get_page_text(
    session: DocumentSession,
    sec: int,
    para_start: int,
    para_end: int,
) -> list[dict[str, Any]]:
    """Collect text of every paragraph in [para_start, para_end] inclusive."""
    out: list[dict[str, Any]] = []
    for p in range(para_start, para_end + 1):
        try:
            length = session.get_paragraph_length(sec, p)
            text = session.get_text_range(sec, p, 0, length) if length > 0 else ""
        except Exception as e:  # noqa: BLE001
            logger.warning("page_text.skip", extra={"sec": sec, "para": p, "error": str(e)[:200]})
            text = ""
            length = 0
        out.append({"para": p, "text": text, "length": length})
    return out
