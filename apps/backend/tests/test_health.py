"""Liveness / readiness smoke tests."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_healthz_returns_200(client: TestClient) -> None:
    r = client.get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "version" in body


def test_readyz_responds(client: TestClient) -> None:
    r = client.get("/readyz")
    # Ready-state depends on whether `claude` CLI is installed on the host;
    # both shapes are valid.
    assert r.status_code == 200
    body = r.json()
    assert body["status"] in ("ready", "degraded")
    assert "checks" in body
    assert "claude_cli_present" in body["checks"]
    assert "claude_cli_runnable" in body["checks"]


def test_unknown_route_returns_404(client: TestClient) -> None:
    r = client.get("/nope")
    assert r.status_code == 404


def test_cors_allows_configured_origin(client: TestClient) -> None:
    r = client.options(
        "/healthz",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert r.status_code in (200, 204)
