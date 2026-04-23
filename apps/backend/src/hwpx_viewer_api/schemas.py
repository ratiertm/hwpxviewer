"""Pydantic I/O models.

Shape mirrors ``apps/web/src/types/index.ts`` so client/server speak the same
structures. HWPX Block schemas mirror COMPONENT_INVENTORY §15 / Design §3.1.
"""

from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field

from .prompts import PromptId


# ============================================================
#  Claude proxy I/O
# ============================================================


class ChatMessage(BaseModel):
    """One turn in the Claude conversation."""

    role: Literal["user", "assistant"]
    content: str


class ClaudeStreamRequest(BaseModel):
    """Client → backend request for streaming chat.

    ``system`` is an identifier; the server expands it to the actual system
    prompt string via prompts.get_prompt().
    """

    system: PromptId
    messages: list[ChatMessage] = Field(min_length=1)


class ClaudeOnceRequest(BaseModel):
    """Client → backend request for single-shot completion (inline edits)."""

    system: PromptId
    prompt: str = Field(min_length=1, max_length=20_000)


class ClaudeOnceResponse(BaseModel):
    text: str


# ============================================================
#  Health
# ============================================================


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    version: str


class ReadinessResponse(BaseModel):
    status: Literal["ready", "degraded"]
    checks: dict[str, bool]
    detail: str | None = None


# ============================================================
#  Block model (frontend-mirrored)
# ============================================================


class TextBlock(BaseModel):
    type: Literal["h1", "h2", "lead", "p"]
    text: str


class TableBlock(BaseModel):
    type: Literal["table"] = "table"
    headers: list[str]
    rows: list[list[str]]


class PageBreakBlock(BaseModel):
    type: Literal["pageBreak"] = "pageBreak"


Block = Annotated[Union[TextBlock, TableBlock, PageBreakBlock], Field(discriminator="type")]


class CoverPage(BaseModel):
    id: Literal[0] = 0
    title: Literal["Cover"] = "Cover"
    section: Literal["00"] = "00"
    isCover: Literal[True] = True


class ContentPage(BaseModel):
    id: int = Field(ge=1)
    title: str
    section: str
    body: list[Block] = Field(default_factory=list)
    isCover: Literal[False] = False


# Discriminated union using the ``isCover`` flag — matches the TS union.
Page = Annotated[Union[CoverPage, ContentPage], Field(discriminator="isCover")]


class DocumentMeta(BaseModel):
    uploadId: str
    fileName: str
    fileSize: int
    hwpxVersion: str | None = None
    unsupportedBlockCount: int = 0


# ============================================================
#  /api/import  /api/export
# ============================================================


class ImportResponse(BaseModel):
    pages: list[Page]
    meta: DocumentMeta


class ExportRequest(BaseModel):
    pages: list[Page]
    uploadId: str
