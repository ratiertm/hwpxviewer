"""Claude proxy routes.

- POST /api/claude/stream  → SSE passthrough (for chat panel)
- POST /api/claude/once    → JSON { text } (for inline edits)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from ..config import Settings, get_settings
from ..schemas import ClaudeOnceRequest, ClaudeOnceResponse, ClaudeStreamRequest
from ..services.claude_cli import once_completion, open_upstream_stream, relay_stream

router = APIRouter(prefix="/api/claude", tags=["claude"])


@router.post("/stream")
async def stream_endpoint(
    req: ClaudeStreamRequest,
    settings: Settings = Depends(get_settings),
) -> StreamingResponse:
    # Open upstream first; any error here is raised as a normal HTTPException
    # BEFORE StreamingResponse commits the HTTP status line.
    proc = await open_upstream_stream(req, settings)
    return StreamingResponse(
        relay_stream(proc),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/once", response_model=ClaudeOnceResponse)
async def once_endpoint(
    req: ClaudeOnceRequest,
    settings: Settings = Depends(get_settings),
) -> ClaudeOnceResponse:
    text = await once_completion(req, settings)
    return ClaudeOnceResponse(text=text)
