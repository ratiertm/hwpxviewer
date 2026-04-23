"""Tests for Claude proxy routes.

Covers request validation and the "CLI not installed" fast-failure path.
Happy-path streaming is exercised via manual smoke + planned M4 E2E.
"""

from __future__ import annotations

from unittest.mock import patch

from fastapi.testclient import TestClient


def test_claude_stream_rejects_invalid_system_identifier(client: TestClient) -> None:
    r = client.post(
        "/api/claude/stream",
        json={"system": "NOT_A_PROMPT", "messages": [{"role": "user", "content": "hi"}]},
    )
    # Pydantic validation rejects before the subprocess is even spawned.
    assert r.status_code == 422


def test_claude_once_validates_empty_prompt(client: TestClient) -> None:
    r = client.post(
        "/api/claude/once",
        json={"system": "inline_editor", "prompt": ""},
    )
    assert r.status_code == 422


def test_claude_stream_requires_nonempty_messages(client: TestClient) -> None:
    r = client.post(
        "/api/claude/stream",
        json={"system": "doc_editor", "messages": []},
    )
    assert r.status_code == 422


def test_claude_once_when_cli_missing(client: TestClient) -> None:
    """When `claude` is not on PATH, /once raises UPSTREAM_UNAVAILABLE."""
    # shutil.which is called inside services.claude_cli._verify_cli_installed.
    with patch("hwpx_viewer_api.services.claude_cli.shutil.which", return_value=None):
        r = client.post(
            "/api/claude/once",
            json={"system": "inline_editor", "prompt": "hello"},
        )
    assert r.status_code == 503
    body = r.json()
    assert body["detail"]["error"]["code"] == "UPSTREAM_UNAVAILABLE"
    assert "claude CLI" in body["detail"]["error"]["detail"]


def test_claude_stream_when_cli_missing(client: TestClient) -> None:
    """When `claude` is not on PATH, /stream fails BEFORE StreamingResponse
    commits, so we still get a proper HTTP error response (not a half-open SSE)."""
    with patch("hwpx_viewer_api.services.claude_cli.shutil.which", return_value=None):
        r = client.post(
            "/api/claude/stream",
            json={"system": "doc_editor", "messages": [{"role": "user", "content": "hi"}]},
        )
    assert r.status_code == 503
    body = r.json()
    assert body["detail"]["error"]["code"] == "UPSTREAM_UNAVAILABLE"
