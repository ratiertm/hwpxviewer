"""Pydantic I/O models.

Shape mirrors ``apps/web/src/types/index.ts`` so client/server speak the same
structures.

Design v0.3: Block model retired. Document is addressed by Run coordinates
(section, paragraph, character offset). All editing flows through the rhwp
WASM engine — see ``services/rhwp_wasm.py``.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .prompts import PromptId


# ============================================================
#  Claude proxy I/O (M2, unchanged)
# ============================================================


class ChatMessage(BaseModel):
    """One turn in the Claude conversation."""

    role: Literal["user", "assistant"]
    content: str


class ClaudeStreamRequest(BaseModel):
    """Client → backend request for streaming chat."""

    system: PromptId
    messages: list[ChatMessage] = Field(min_length=1)


class ClaudeOnceRequest(BaseModel):
    """Client → backend request for single-shot completion (inline edits)."""

    system: PromptId
    prompt: str = Field(min_length=1, max_length=20_000)


class ClaudeOnceResponse(BaseModel):
    text: str


# ============================================================
#  Health (unchanged)
# ============================================================


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    version: str


class ReadinessResponse(BaseModel):
    status: Literal["ready", "degraded"]
    checks: dict[str, bool]
    detail: str | None = None


# ============================================================
#  Document session (M4R)
# ============================================================


class DocumentInfo(BaseModel):
    """Metadata for an uploaded HWPX document."""

    uploadId: str
    fileName: str
    fileSize: int
    pageCount: int
    version: int = 0  # increments on every successful edit


class UploadResponse(BaseModel):
    """Result of ``POST /api/upload``."""

    document: DocumentInfo


# ============================================================
#  Run coordinates (M5R/M6R) — the single addressing unit for edits
# ============================================================


class RunLocation(BaseModel):
    """A single point inside the document.

    ``sec`` — section index (0-based)
    ``para`` — paragraph index within the section (0-based)
    ``charOffset`` — character offset within the paragraph's concatenated text
    """

    sec: int = Field(ge=0)
    para: int = Field(ge=0)
    charOffset: int = Field(ge=0)


class Selection(BaseModel):
    """A contiguous text range. Matches the shape the rhwp ``insertText``/
    ``deleteText`` API expects: start location + character length.
    """

    start: RunLocation
    length: int = Field(ge=0)


# ============================================================
#  Hit-test (M5R) — screen (x, y) → RunLocation
# ============================================================


class HitTestRequest(BaseModel):
    uploadId: str
    page: int = Field(ge=0)
    x: float
    y: float


class HitTestResponse(BaseModel):
    location: RunLocation | None = None  # None if the point is outside any text


# ============================================================
#  Selection rects (M5R) — Selection → highlight pixel boxes
# ============================================================


class SelectionRectsRequest(BaseModel):
    uploadId: str
    selection: Selection


class SelectionRect(BaseModel):
    page: int
    x: float
    y: float
    width: float
    height: float


class SelectionRectsResponse(BaseModel):
    rects: list[SelectionRect]


# ============================================================
#  Edit (M6R) — apply a text replacement
# ============================================================


class EditRequest(BaseModel):
    uploadId: str
    selection: Selection  # range to be replaced
    newText: str          # replacement text (may be empty to pure-delete)


class EditResponse(BaseModel):
    editId: int
    document: DocumentInfo     # updated version / pageCount
    affectedPages: list[int]   # pages that need re-rendering


class UndoRequest(BaseModel):
    uploadId: str
    editId: int


class TextRangeRequest(BaseModel):
    uploadId: str
    selection: Selection


class TextRangeResponse(BaseModel):
    text: str
