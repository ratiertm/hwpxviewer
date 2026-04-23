"""Claude Code CLI subprocess adapter.

Replaces the httpx-based direct Anthropic API call with ``claude -p`` subprocess
calls that use the user's OAuth session (Claude Pro/Max). This removes
ANTHROPIC_API_KEY management entirely.

Key design points:

* ``ANTHROPIC_API_KEY`` is **removed** from the subprocess env so the CLI
  falls back to OAuth/keychain (matches the behavior documented in
  ``claude --help`` for ``--bare``: OAuth is only skipped when --bare is set).
* MCP servers, user/project settings, slash commands, tools, and session
  persistence are all **disabled** so each call is isolated and the system
  prompt we pass is the only instruction reaching the model.
* ``--output-format stream-json`` emits line-delimited JSON. Each ``stream_event``
  carries an ``event`` field whose shape matches Anthropic's SSE wire format
  (``message_start`` / ``content_block_delta`` / ``message_stop`` …), so we
  re-emit it as ``data: <json>\\n\\n`` and the prototype frontend parser keeps
  working unchanged.
* ``--output-format json`` (for once-shot inline edits) returns a single JSON
  object with ``result``, ``is_error``, ``api_error_status``.

If the Claude CLI is not installed or not authenticated, the service surfaces
the failure as a normal ``HTTPException`` BEFORE the StreamingResponse commits.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
from collections.abc import AsyncIterator

from ..config import Settings
from ..errors import ErrorCode, app_error
from ..prompts import get_prompt
from ..schemas import ChatMessage, ClaudeOnceRequest, ClaudeStreamRequest


# ---- CLI invocation --------------------------------------------------------

_COMMON_FLAGS: tuple[str, ...] = (
    "-p",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--setting-sources",
    "",
    "--disable-slash-commands",
    "--tools",
    "",
    "--dangerously-skip-permissions",
    "--no-session-persistence",
)


def _cli_env() -> dict[str, str]:
    """Subprocess env: start from parent, strip ANTHROPIC_API_KEY so OAuth wins."""
    env = os.environ.copy()
    env.pop("ANTHROPIC_API_KEY", None)
    return env


def _serialize_conversation(messages: list[ChatMessage]) -> str:
    """Turn a multi-turn conversation into a single prompt block.

    ``claude -p`` accepts one prompt argument. We serialize the whole history
    as a tagged transcript. The system prompt stays in --system-prompt.

    This wastes tokens compared to ``--resume`` but avoids server-side session
    state for v1.0. A follow-up can add session caching keyed by a client
    conversation id.
    """
    if not messages:
        return ""
    parts: list[str] = []
    for m in messages[:-1]:
        parts.append(f"[{m.role.upper()}]\n{m.content}")
    last = messages[-1]
    if last.role == "user":
        parts.append(f"[USER]\n{last.content}")
    else:
        parts.append(f"[ASSISTANT]\n{last.content}\n[USER]\n(continue)")
    return "\n\n".join(parts)


def _classify_error(api_status: int | None, message: str | None) -> ErrorCode:
    if api_status in (401, 403):
        return "AUTH_ERROR"
    if api_status == 429:
        return "RATE_LIMITED"
    if message and "not found" in message.lower():
        return "UPSTREAM_UNAVAILABLE"
    return "UPSTREAM_UNAVAILABLE"


def _verify_cli_installed() -> None:
    if shutil.which("claude") is None:
        raise app_error(
            "UPSTREAM_UNAVAILABLE",
            detail="claude CLI not found on PATH. Install Claude Code and run `claude auth`.",
        )


# ---- Streaming -------------------------------------------------------------


async def open_upstream_stream(
    req: ClaudeStreamRequest, settings: Settings
) -> asyncio.subprocess.Process:
    """Spawn ``claude -p --output-format stream-json`` and verify it started.

    Reads the first stdout line (should be ``system/init``). If the CLI fails
    fast (e.g., not authenticated → immediate ``result`` event with
    ``is_error``), raises HTTPException before any HTTP response is committed.

    On success, returns the live subprocess. The caller must feed
    ``proc.stdout`` into ``relay_stream``.
    """
    _verify_cli_installed()

    args: list[str] = [
        *_COMMON_FLAGS,
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--system-prompt",
        get_prompt(req.system),
        "--model",
        settings.claude_model,
        _serialize_conversation(list(req.messages)),
    ]

    proc = await asyncio.create_subprocess_exec(
        settings.claude_cli_path,
        *args,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=_cli_env(),
    )

    # Prime the stream — wait for the first line or fast failure.
    assert proc.stdout is not None  # subprocess.PIPE above guarantees this
    try:
        first_line = await asyncio.wait_for(proc.stdout.readline(), timeout=15.0)
    except TimeoutError as e:
        proc.kill()
        await proc.wait()
        raise app_error("UPSTREAM_UNAVAILABLE", detail="claude CLI first-line timeout") from e

    if not first_line:
        # Process exited before producing output → read stderr and return code.
        await proc.wait()
        stderr = b""
        if proc.stderr is not None:
            stderr = await proc.stderr.read()
        raise app_error(
            "UPSTREAM_UNAVAILABLE",
            detail=(
                f"claude CLI exited rc={proc.returncode} before any output: "
                f"{stderr.decode(errors='replace')[:300]}"
            ),
        )

    try:
        first_event = json.loads(first_line)
    except json.JSONDecodeError as e:
        proc.kill()
        await proc.wait()
        raise app_error(
            "UPSTREAM_UNAVAILABLE",
            detail=f"claude CLI first line is not JSON: {first_line[:200]!r}",
        ) from e

    # Fast-failure path: result event with is_error=true.
    if first_event.get("type") == "result" and first_event.get("is_error"):
        api_status = first_event.get("api_error_status")
        message = first_event.get("result") or ""
        await proc.wait()
        raise app_error(
            _classify_error(api_status, message),
            detail=f"claude CLI: {message[:300]}",
        )

    # Good path: first event should be system/init. We discard it — the
    # relay only re-emits stream_event events.
    return proc


async def relay_stream(proc: asyncio.subprocess.Process) -> AsyncIterator[bytes]:
    """Read stream-json from the subprocess and re-emit as Anthropic SSE.

    The prototype frontend parses ``content_block_delta.delta.text_delta`` and
    stops on ``[DONE]``. claude -p's ``stream_event.event`` payload is the
    raw Anthropic event, so we just wrap it.
    """
    assert proc.stdout is not None

    try:
        async for raw_line in proc.stdout:
            line = raw_line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue  # ignore malformed lines; shouldn't happen

            etype = event.get("type")
            if etype == "stream_event":
                inner = event.get("event")
                if isinstance(inner, dict):
                    yield f"data: {json.dumps(inner, ensure_ascii=False)}\n\n".encode()
                continue

            if etype == "result":
                if event.get("is_error"):
                    err_payload = {
                        "type": "error",
                        "error": {
                            "type": "upstream_error",
                            "message": event.get("result", "unknown"),
                            "api_error_status": event.get("api_error_status"),
                        },
                    }
                    yield f"event: error\ndata: {json.dumps(err_payload)}\n\n".encode()
                yield b"data: [DONE]\n\n"
                break

            # Other event types (system/init, assistant, rate_limit_event) are
            # intentionally dropped — the frontend parser doesn't need them.
    finally:
        if proc.returncode is None:
            try:
                proc.terminate()
                await asyncio.wait_for(proc.wait(), timeout=3.0)
            except TimeoutError:
                proc.kill()
                await proc.wait()


# ---- Once (non-streaming) --------------------------------------------------


async def once_completion(req: ClaudeOnceRequest, settings: Settings) -> str:
    """Single-shot completion for inline edits. Returns the raw text content."""
    _verify_cli_installed()

    args: list[str] = [
        *_COMMON_FLAGS,
        "--output-format",
        "json",
        "--system-prompt",
        get_prompt(req.system),
        "--model",
        settings.claude_model,
        req.prompt,
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
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=60.0)
    except TimeoutError as e:
        proc.kill()
        await proc.wait()
        raise app_error("UPSTREAM_UNAVAILABLE", detail="claude CLI once timeout") from e

    if proc.returncode != 0 and not stdout:
        raise app_error(
            "UPSTREAM_UNAVAILABLE",
            detail=(
                f"claude CLI rc={proc.returncode}, stderr="
                f"{stderr.decode(errors='replace')[:300]}"
            ),
        )

    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as e:
        raise app_error(
            "UPSTREAM_UNAVAILABLE",
            detail=f"claude CLI non-JSON output: {stdout[:200]!r}",
        ) from e

    if data.get("is_error"):
        api_status = data.get("api_error_status")
        message = data.get("result") or ""
        raise app_error(
            _classify_error(api_status, message),
            detail=f"claude CLI: {message[:300]}",
        )

    result = data.get("result", "")
    return result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
