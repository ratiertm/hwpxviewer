"""End-to-end HTTP tests for /api/import and /api/export."""

from __future__ import annotations

import io
import json
import os
import tempfile

from fastapi.testclient import TestClient


def test_import_returns_pages_and_meta(
    client: TestClient, sample_hwpx_bytes: bytes
) -> None:
    files = {
        "file": (
            "사업계획서.hwpx",
            io.BytesIO(sample_hwpx_bytes),
            "application/vnd.hancom.hwpx",
        )
    }
    r = client.post("/api/import", files=files)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "pages" in body and "meta" in body
    assert body["meta"]["fileName"] == "사업계획서.hwpx"
    assert body["meta"]["fileSize"] == len(sample_hwpx_bytes)
    assert isinstance(body["meta"]["uploadId"], str) and len(body["meta"]["uploadId"]) >= 32
    # At least one page with a heading block.
    page_types = [b["type"] for b in body["pages"][0]["body"]]
    assert "h1" in page_types


def test_import_rejects_non_hwpx(client: TestClient) -> None:
    files = {
        "file": (
            "a.docx",
            io.BytesIO(b"PK\x03\x04some-docx-bytes"),
            "application/octet-stream",
        )
    }
    r = client.post("/api/import", files=files)
    assert r.status_code == 400
    assert r.json()["detail"]["error"]["code"] == "INVALID_FILE"


def test_import_rejects_bad_magic(client: TestClient) -> None:
    files = {
        "file": (
            "a.hwpx",
            io.BytesIO(b"GARBAGE-NOT-ZIP"),
            "application/octet-stream",
        )
    }
    r = client.post("/api/import", files=files)
    assert r.status_code == 415
    assert r.json()["detail"]["error"]["code"] == "UNSUPPORTED_FORMAT"


def test_export_round_trip_preserves_bytes_of_unedited_page(
    client: TestClient, sample_hwpx_bytes: bytes
) -> None:
    # 1. Import.
    r = client.post(
        "/api/import",
        files={
            "file": ("sample.hwpx", io.BytesIO(sample_hwpx_bytes), "application/octet-stream")
        },
    )
    assert r.status_code == 200
    body = r.json()
    pages = body["pages"]
    upload_id = body["meta"]["uploadId"]

    # 2. Export without any edits.
    r2 = client.post("/api/export", json={"pages": pages, "uploadId": upload_id})
    assert r2.status_code == 200
    assert r2.headers["content-type"].startswith("application/vnd.hancom.hwpx")
    out = r2.content
    assert out.startswith(b"PK\x03\x04")
    # Filename header should include RFC5987-encoded Korean name.
    cd = r2.headers["content-disposition"]
    assert "filename*=UTF-8''" in cd
    assert "%28%EC%88%98%EC%A0%95%29" in cd  # "(수정)" URL-encoded

    # 3. Re-import the exported bytes and verify we get the same block shape.
    r3 = client.post(
        "/api/import",
        files={
            "file": ("out.hwpx", io.BytesIO(out), "application/octet-stream")
        },
    )
    assert r3.status_code == 200
    body3 = r3.json()
    assert body3["pages"][0]["body"] == pages[0]["body"]


def test_export_rejects_unknown_upload_id(client: TestClient) -> None:
    r = client.post(
        "/api/export",
        json={
            "pages": [
                {
                    "id": 1,
                    "title": "x",
                    "section": "01",
                    "body": [],
                    "isCover": False,
                }
            ],
            "uploadId": "00000000-0000-0000-0000-000000000000",
        },
    )
    assert r.status_code == 404
    assert r.json()["detail"]["error"]["code"] == "UPLOAD_EXPIRED"


def test_export_reflects_text_edit(
    client: TestClient, sample_hwpx_bytes: bytes
) -> None:
    r = client.post(
        "/api/import",
        files={"file": ("s.hwpx", io.BytesIO(sample_hwpx_bytes), "application/octet-stream")},
    )
    body = r.json()
    pages = body["pages"]
    upload_id = body["meta"]["uploadId"]

    # Edit the p block.
    for b in pages[0]["body"]:
        if b["type"] == "p":
            b["text"] = "편집된 본문입니다."
            break

    r2 = client.post("/api/export", json={"pages": pages, "uploadId": upload_id})
    assert r2.status_code == 200

    # Re-import, verify the edit survived.
    r3 = client.post(
        "/api/import",
        files={"file": ("out.hwpx", io.BytesIO(r2.content), "application/octet-stream")},
    )
    body3 = r3.json()
    p_block = next(b for b in body3["pages"][0]["body"] if b["type"] == "p")
    assert p_block["text"] == "편집된 본문입니다."


def test_export_rejects_block_sequence_divergence(
    client: TestClient, sample_hwpx_bytes: bytes
) -> None:
    r = client.post(
        "/api/import",
        files={"file": ("s.hwpx", io.BytesIO(sample_hwpx_bytes), "application/octet-stream")},
    )
    body = r.json()
    pages = body["pages"]
    upload_id = body["meta"]["uploadId"]

    # Add a new paragraph — not supported in v1.0.
    pages[0]["body"].append({"type": "p", "text": "신규 문단"})

    r2 = client.post("/api/export", json={"pages": pages, "uploadId": upload_id})
    assert r2.status_code == 500
    assert r2.json()["detail"]["error"]["code"] == "CONVERTER_ERROR"
    assert "v1.0에서 지원하지 않습니다" in r2.json()["detail"]["error"]["message"]


def test_export_rejects_page_count_mismatch(
    client: TestClient, sample_hwpx_bytes: bytes
) -> None:
    """Adding a whole page (== new section) is also rejected in v1.0."""
    r = client.post(
        "/api/import",
        files={"file": ("s.hwpx", io.BytesIO(sample_hwpx_bytes), "application/octet-stream")},
    )
    body = r.json()
    pages = body["pages"]
    upload_id = body["meta"]["uploadId"]

    pages.append(
        {
            "id": len(pages) + 1,
            "title": "new section",
            "section": f"{len(pages) + 1:02d}",
            "body": [{"type": "h1", "text": "추가 섹션"}],
            "isCover": False,
        }
    )

    r2 = client.post("/api/export", json={"pages": pages, "uploadId": upload_id})
    assert r2.status_code == 500
    assert r2.json()["detail"]["error"]["code"] == "CONVERTER_ERROR"
    assert "v1.0" in r2.json()["detail"]["error"]["message"]
