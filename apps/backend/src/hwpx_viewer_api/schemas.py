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


class CellRef(BaseModel):
    """Pointer to a single table cell within a section.

    rhwp addresses table cell text as
    ``(sec, parentParaIndex, controlIndex, cellIndex, cellParaIndex, offset)``.
    When a RunLocation has ``cell`` set, its ``para`` field is interpreted
    as ``cellParaIndex`` (the paragraph index **inside the cell**) instead
    of the section paragraph index.
    """
    parentParaIndex: int = Field(ge=0)
    controlIndex: int = Field(ge=0)
    cellIndex: int = Field(ge=0)


class RunLocation(BaseModel):
    """A single point inside the document.

    ``sec`` — section index (0-based)
    ``para`` — paragraph index. When ``cell`` is None this is a section
      paragraph; otherwise it is the cell-local paragraph index
      (``cellParaIndex``).
    ``charOffset`` — character offset within that paragraph.
    ``cell`` — table-cell context. When set, edits go through rhwp's
      ``*InCell`` WASM exports; when None, the normal body-text exports
      are used.
    """

    sec: int = Field(ge=0)
    para: int = Field(ge=0)
    charOffset: int = Field(ge=0)
    cell: CellRef | None = None


class Selection(BaseModel):
    """A contiguous text range.

    Two shapes:
      - **single paragraph**: ``{ start, length }`` — legacy form. ``end``
        is ``None`` and the range stays within ``start.para``.
      - **multi paragraph / multi cell-para**: ``{ start, end }`` — used for
        cross-paragraph selections. ``length`` is ignored server-side when
        ``end`` is present.

    For cell selections, ``end.cell`` must equal ``start.cell`` (cells can
    span multiple cell-paragraphs, but not jump between cells or between
    body and cell). The server rejects mixed forms.
    """

    start: RunLocation
    length: int = Field(default=0, ge=0)
    end: RunLocation | None = None


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


# ============================================================
#  Paragraph info (M5R click-to-select) — whole-paragraph selection
# ============================================================


class ParagraphRequest(BaseModel):
    uploadId: str
    sec: int = Field(ge=0)
    para: int = Field(ge=0)
    cell: CellRef | None = None   # when set, ``para`` is cellParaIndex


class ParagraphResponse(BaseModel):
    """Length + text of a whole paragraph. Drives click-to-select: a single
    hit-test gives (sec, para), then this endpoint returns the full run so the
    UI can highlight the entire paragraph.
    """
    length: int
    text: str


# ============================================================
#  Document generation (Phase 1) — Claude plans, backend dispatches
# ============================================================
#
# Claude is restricted to text-out + JSON. It emits a ``DocumentPlan`` which
# the backend translates into pyhwpxlib calls. This decouples model output
# from runtime side effects: the model never executes Bash and never touches
# the filesystem. See ``services/plan_dispatcher.py``.

Intent = Literal["new_doc", "gongmun", "form_fill", "edit", "convert"]
ThemeName = Literal[
    "default", "forest", "warm_executive", "ocean_analytics", "coral_energy",
    "charcoal_minimal", "teal_trust", "berry_cream", "sage_calm", "cherry_bold",
]


class PlanBlockHeading(BaseModel):
    type: Literal["heading"] = "heading"
    level: int = Field(default=1, ge=1, le=6)
    text: str = Field(min_length=1)


class PlanBlockParagraph(BaseModel):
    type: Literal["paragraph"] = "paragraph"
    text: str = Field(default="")
    bold: bool | None = None
    italic: bool | None = None
    font_size: int | None = None
    alignment: Literal["LEFT", "CENTER", "RIGHT", "JUSTIFY"] | None = None


class PlanBlockSpacer(BaseModel):
    type: Literal["spacer"] = "spacer"


class PlanBlockTable(BaseModel):
    type: Literal["table"] = "table"
    headers: list[str] | None = None
    rows: list[list[str]] = Field(default_factory=list)


class PlanBlockBullet(BaseModel):
    type: Literal["bullet_list"] = "bullet_list"
    items: list[str] = Field(default_factory=list)


class PlanBlockNumbered(BaseModel):
    type: Literal["numbered_list"] = "numbered_list"
    items: list[str] = Field(default_factory=list)


PlanBlock = (
    PlanBlockHeading
    | PlanBlockParagraph
    | PlanBlockSpacer
    | PlanBlockTable
    | PlanBlockBullet
    | PlanBlockNumbered
)


class GongmunSigner(BaseModel):
    """기안자/결재권자 정보."""
    직위: str | None = None
    이름: str | None = None
    전결: bool = False
    서명일자: str | None = None


class GongmunSpec(BaseModel):
    """공문(기안문) 전용 필드. ``intent == 'gongmun'`` 일 때만 채워진다."""
    기관명: str | None = None
    수신: str | None = None
    제목: str | None = None
    본문: list[str] = Field(default_factory=list)
    붙임: list[str] = Field(default_factory=list)
    발신명의: str | None = None
    기안자: GongmunSigner | None = None
    결재권자: GongmunSigner | None = None
    시행_처리과명: str | None = None
    시행_일련번호: str | None = None
    시행일: str | None = None
    우편번호: str | None = None
    도로명주소: str | None = None
    전화: str | None = None
    공개구분: str | None = None


class DocumentPlan(BaseModel):
    """Claude → backend plan. Backend dispatches via plan_dispatcher."""
    intent: Intent = "new_doc"
    theme: ThemeName | str = "default"
    title: str | None = None
    blocks: list[PlanBlock] = Field(default_factory=list)
    gongmun: GongmunSpec | None = None


class GenerateStartRequest(BaseModel):
    """Frontend → backend kickoff."""
    intent: Intent = "new_doc"
    theme: ThemeName | str | None = None  # optional hint; Claude may override
    prompt: str = Field(min_length=1, max_length=20_000)


class GenerateStartResponse(BaseModel):
    jobId: str
