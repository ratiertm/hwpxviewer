"""Liveness and readiness endpoints.

- /healthz  always-200 while the process is alive.
- /readyz   returns ready=true only if the ``claude`` CLI is installed and
            can report its version (which implies auth state is at least
            inspectable; actual OAuth validity is only confirmed on first call).
"""

from __future__ import annotations

import asyncio
import shutil

from fastapi import APIRouter, Depends

from .. import __version__
from ..config import Settings, get_settings
from ..schemas import HealthResponse, ReadinessResponse

router = APIRouter(tags=["health"])


@router.get("/healthz", response_model=HealthResponse)
async def healthz() -> HealthResponse:
    return HealthResponse(version=__version__)


@router.get("/readyz", response_model=ReadinessResponse)
async def readyz(settings: Settings = Depends(get_settings)) -> ReadinessResponse:
    checks: dict[str, bool] = {"claude_cli_present": False, "claude_cli_runnable": False}
    detail: str | None = None

    cli_path = shutil.which(settings.claude_cli_path)
    checks["claude_cli_present"] = cli_path is not None

    if cli_path is not None:
        try:
            proc = await asyncio.create_subprocess_exec(
                cli_path,
                "--version",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=5.0)
            checks["claude_cli_runnable"] = proc.returncode == 0 and bool(stdout.strip())
            if not checks["claude_cli_runnable"]:
                detail = f"claude --version rc={proc.returncode}"
        except (TimeoutError, OSError) as e:
            detail = f"claude --version: {e.__class__.__name__}"
    else:
        detail = f"claude CLI not found on PATH (configured path: {settings.claude_cli_path})"

    all_ok = all(checks.values())
    return ReadinessResponse(
        status="ready" if all_ok else "degraded",
        checks=checks,
        detail=detail,
    )
