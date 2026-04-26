"""Document generation routes (Phase 1).

  POST /api/generate/start          { intent, prompt, theme? } → { jobId }
  GET  /api/generate/stream/{jobId} → SSE step events

The start endpoint kicks off an asyncio worker and returns immediately.
The stream endpoint replays queued events as they arrive.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..schemas import GenerateStartRequest, GenerateStartResponse
from ..services.generate_jobs import get_job_registry, stream_job_events
from ..services.generate_worker import run_generate_job

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/generate", tags=["generate"])


@router.post("/start", response_model=GenerateStartResponse)
async def start(req: GenerateStartRequest) -> GenerateStartResponse:
    registry = get_job_registry()
    job = await registry.create()
    job.task = asyncio.create_task(run_generate_job(job.job_id, req))
    return GenerateStartResponse(jobId=job.job_id)


@router.get("/stream/{job_id}")
async def stream(job_id: str) -> StreamingResponse:
    registry = get_job_registry()
    job = await registry.get(job_id)
    if job is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "JOB_NOT_FOUND",
                    "message": "이 생성 작업을 찾을 수 없습니다 (만료되었을 수 있어요).",
                    "recoverable": False,
                }
            },
        )
    return StreamingResponse(
        stream_job_events(job),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
