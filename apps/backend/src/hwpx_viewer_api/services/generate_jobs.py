"""In-memory job registry for ``/api/generate/*``.

Each ``POST /api/generate/start`` allocates a ``jobId`` and spawns an
asyncio task. The frontend then opens an EventSource on
``/api/generate/stream/{jobId}`` and receives step events:

  data: {"step":"plan",     "msg":"Claude 가 구조 짜는 중"}
  data: {"step":"build",    "msg":"HwpxBuilder 실행"}
  data: {"step":"validate", "msg":"검증"}
  data: {"step":"render",   "msg":"미리보기 렌더"}
  data: {"step":"done",     "uploadId":"..."}
  data: {"step":"error",    "code":"...", "message":"..."}

Memory-only, single-process. Jobs auto-evict after 10 minutes. The actual
Claude call + dispatch happens inside the asyncio task so the start endpoint
returns immediately.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from collections import OrderedDict
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

_JOB_TTL_SECONDS = 10 * 60
_JOB_CAPACITY = 100


@dataclass
class JobEvent:
    step: str
    payload: dict[str, Any] = field(default_factory=dict)
    ts: float = field(default_factory=time.time)


@dataclass
class Job:
    job_id: str
    queue: asyncio.Queue[JobEvent] = field(default_factory=asyncio.Queue)
    finished: bool = False
    created_at: float = field(default_factory=time.time)
    task: asyncio.Task | None = None


class JobRegistry:
    def __init__(self) -> None:
        self._jobs: OrderedDict[str, Job] = OrderedDict()
        self._lock = asyncio.Lock()

    async def create(self) -> Job:
        async with self._lock:
            self._evict_locked()
            job = Job(job_id=str(uuid.uuid4()))
            self._jobs[job.job_id] = job
            return job

    async def get(self, job_id: str) -> Job | None:
        async with self._lock:
            return self._jobs.get(job_id)

    async def emit(self, job_id: str, step: str, **payload: Any) -> None:
        async with self._lock:
            job = self._jobs.get(job_id)
        if job is None:
            return
        evt = JobEvent(step=step, payload=payload)
        await job.queue.put(evt)
        if step in ("done", "error"):
            job.finished = True

    def _evict_locked(self) -> None:
        now = time.time()
        for jid in list(self._jobs.keys()):
            j = self._jobs[jid]
            if now - j.created_at > _JOB_TTL_SECONDS:
                self._jobs.pop(jid, None)
        while len(self._jobs) > _JOB_CAPACITY:
            self._jobs.popitem(last=False)


_singleton = JobRegistry()


def get_job_registry() -> JobRegistry:
    return _singleton


async def stream_job_events(job: Job) -> AsyncIterator[bytes]:
    """SSE-formatted byte stream. Closes when ``finished`` event drained."""
    while True:
        try:
            evt = await asyncio.wait_for(job.queue.get(), timeout=60.0)
        except TimeoutError:
            # Heartbeat to keep proxies from killing the connection.
            yield b": heartbeat\n\n"
            if job.finished:
                break
            continue
        body = {"step": evt.step, **evt.payload}
        yield f"data: {json.dumps(body, ensure_ascii=False)}\n\n".encode()
        if evt.step in ("done", "error"):
            break
