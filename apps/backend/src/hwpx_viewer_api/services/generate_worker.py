"""Worker that turns a ``GenerateStartRequest`` into a registered uploadId.

Pipeline:
  1. plan     — call Claude (isolated, JSON-only) with hwpx skill guide
                injected as system prompt. Parse output as ``DocumentPlan``.
  2. build    — ``plan_dispatcher.render_plan_to_path``  → tmp .hwpx
  3. validate — ``plan_dispatcher.validate_generated``    → warnings list
  4. register — load tmp .hwpx via rhwp_wasm + insert into upload_store
  5. done     — emit { uploadId, fileName, pageCount, warnings }

Errors at any stage emit step=error with code+message. The asyncio task
NEVER raises out of the registry — every exception is converted to an
SSE error event so the client always receives a terminal frame.
"""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

from pydantic import ValidationError

from ..config import get_settings
from ..schemas import (
    ClaudeOnceRequest,
    DocumentPlan,
    GenerateStartRequest,
)
from ..skills.hwpx_guide import compose_system_prompt
from .generate_jobs import get_job_registry
from .lineseg_postprocess import synthesize_linesegs
from .plan_dispatcher import render_plan_to_path, temp_output_path, validate_generated
from .rhwp_wasm import get_engine
from .upload_store import get_upload_store

logger = logging.getLogger(__name__)


def _extract_json(text: str) -> dict:
    """Strip code fences / leading prose, return the first JSON object found.

    Mirrors ``apps/web/src/lib/json.ts`` extractJson behavior.
    """
    s = text.strip()
    if s.startswith("```"):
        # ```json\n...\n``` → drop fences
        first_nl = s.find("\n")
        if first_nl != -1:
            s = s[first_nl + 1 :]
        if s.endswith("```"):
            s = s[:-3]
        s = s.strip()
    # Find first { … } balanced span.
    start = s.find("{")
    if start == -1:
        raise ValueError("no JSON object in Claude output")
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(s)):
        ch = s[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return json.loads(s[start : i + 1])
    raise ValueError("unterminated JSON object")


async def _call_planner(req: GenerateStartRequest) -> DocumentPlan:
    """Call Claude in isolated mode with the hwpx skill guide as system prompt.

    Single retry on JSON parse / Pydantic validation failure: if the first
    response can't be turned into a ``DocumentPlan``, we re-issue with a
    sterner system-prompt suffix that quotes the failure and demands the
    raw JSON only. This catches common sin patterns:
      - "Sure, here's…" preamble
      - Markdown fence with extra explanation
      - Missing required fields (intent / theme)
    """
    system = compose_system_prompt(req.intent)
    user_payload = {
        "intent_hint": req.intent,
        "theme_hint": req.theme,
        "user_request": req.prompt,
        "instructions": (
            "위 user_request 를 분석해 시스템 프롬프트의 스키마에 맞는 JSON 한 덩이만 출력하라. "
            "코드 펜스 금지, 다른 설명 금지."
        ),
    }
    user_prompt = json.dumps(user_payload, ensure_ascii=False)

    try:
        return await _claude_planner_call(system, user_prompt)
    except (json.JSONDecodeError, ValueError, ValidationError) as first_err:
        logger.warning("planner.first_attempt_failed", extra={"error": str(first_err)[:300]})

    # Retry once with a stricter trailing reminder.
    strict_system = (
        system
        + "\n\n---\n[중요 — 1차 시도 실패] 직전 응답이 스키마/JSON 검증에 실패했다.\n"
        + "이번에는 반드시:\n"
        + "1) 첫 글자부터 ``{`` 로 시작\n"
        + "2) 마지막 글자가 ``}``\n"
        + "3) 사이에 코드 펜스, 한국어 설명, 인사 일체 금지\n"
        + "4) intent / theme / blocks 필드 필수"
    )
    return await _claude_planner_call(strict_system, user_prompt)


async def _claude_planner_call(system_prompt: str, user_prompt: str) -> DocumentPlan:
    """Spawn ``claude -p`` with isolated flags and our system prompt."""
    from .claude_cli import _COMMON_FLAGS, _cli_env, _verify_cli_installed

    settings = get_settings()
    _verify_cli_installed()

    args: list[str] = [
        *_COMMON_FLAGS,
        "--output-format",
        "json",
        "--system-prompt",
        system_prompt,
        "--model",
        settings.claude_model,
        user_prompt,
    ]

    proc = await asyncio.create_subprocess_exec(
        settings.claude_cli_path,
        *args,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=_cli_env(),
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120.0)
    except TimeoutError as e:
        proc.kill()
        await proc.wait()
        raise RuntimeError("Claude planner timeout") from e

    if proc.returncode != 0 and not stdout:
        raise RuntimeError(
            f"Claude planner rc={proc.returncode}: "
            f"{stderr.decode(errors='replace')[:300]}"
        )
    data = json.loads(stdout)
    if data.get("is_error"):
        raise RuntimeError(f"Claude planner error: {data.get('result', '')[:300]}")
    raw = data.get("result", "")
    if not isinstance(raw, str):
        raw = json.dumps(raw, ensure_ascii=False)
    plan_obj = _extract_json(raw)
    return DocumentPlan.model_validate(plan_obj)


# ---- Public entrypoint -----------------------------------------------------


async def run_generate_job(job_id: str, req: GenerateStartRequest) -> None:
    """Run the full pipeline. Emits SSE events into the job registry.

    NEVER raises — terminal errors are emitted as ``step="error"`` events.
    """
    registry = get_job_registry()
    out_path: Path | None = None
    try:
        await registry.emit(job_id, "plan", message="Claude 가 문서 구조를 짜는 중…")
        plan = await _call_planner(req)
        await registry.emit(
            job_id,
            "plan_ready",
            message="플랜 완성",
            theme=plan.theme,
            blockCount=len(plan.blocks),
            title=plan.title or "",
        )

        await registry.emit(job_id, "build", message="HwpxBuilder 실행 중…")
        out_path = temp_output_path()
        render_plan_to_path(plan, out_path)

        # Synthesize <hp:linesegarray> on every paragraph so rhwp validators
        # (LinesegArrayEmpty / LinesegUncomputed) stay quiet. HwpxBuilder
        # ships placeholder/empty arrays; this fills them with a default
        # vertsize so line_height parses non-zero. See lineseg_postprocess.py.
        await registry.emit(job_id, "validate", message="lineseg 보정 + 문서 검증 중…")
        raw_bytes = out_path.read_bytes()
        data = synthesize_linesegs(raw_bytes)
        if data != raw_bytes:
            out_path.write_bytes(data)
        warnings = validate_generated(out_path)

        await registry.emit(job_id, "register", message="뷰어에 로드 중…")
        engine = get_engine()
        title_hint = (plan.title or req.prompt[:30]).strip() or "AI 생성 문서"
        file_name = f"{title_hint}.hwpx"
        # ``data`` is the post-processed bytes — rhwp loads them, and the
        # same bytes are what /api/download serves later (via upload_store
        # → rhwp_wasm DocumentSession._original_bytes).
        session = engine.load_document_bytes(data, name=file_name)
        upload_id = get_upload_store().put(
            session=session,
            file_name=file_name,
            file_size=len(data),
        )

        await registry.emit(
            job_id,
            "done",
            uploadId=upload_id,
            fileName=file_name,
            pageCount=session.page_count,
            warnings=warnings,
        )
    except Exception as e:
        logger.exception("generate_worker.failed", extra={"jobId": job_id})
        await registry.emit(
            job_id,
            "error",
            code="GENERATE_FAILED",
            message=str(e)[:500] or "문서 생성 중 오류",
        )
    finally:
        if out_path is not None:
            try:
                out_path.unlink(missing_ok=True)
            except Exception:
                pass
