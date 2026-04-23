"""Error catalog — mirrors Design §6.1. Keep in sync with
apps/web/src/types/index.ts::ErrorCode."""

from __future__ import annotations

from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel

ErrorCode = Literal[
    "INVALID_FILE",
    "FILE_TOO_LARGE",
    "UNSUPPORTED_FORMAT",
    "CONVERTER_ERROR",
    "INVALID_BLOCKS",
    "UPLOAD_EXPIRED",
    "AUTH_ERROR",
    "RATE_LIMITED",
    "UPSTREAM_UNAVAILABLE",
    "NETWORK_ERROR",
    "JSON_PARSE_FAILED",
]


class ErrorPayload(BaseModel):
    code: ErrorCode
    message: str
    detail: str | None = None
    recoverable: bool = True


class ErrorEnvelope(BaseModel):
    error: ErrorPayload


# Code → (HTTP status, Korean message, recoverable) mapping.
# Messages mirror `docs/02-design/features/hwpx-viewer-mvp.design.md` §6.1.
# For FILE_TOO_LARGE the runtime MAX_UPLOAD_MB value is injected via
# ``app_error(code, message_override=...)`` — keep the default as a
# stable fallback that still communicates the cause.
_CATALOG: dict[ErrorCode, tuple[int, str, bool]] = {
    "INVALID_FILE": (400, ".hwpx 파일만 업로드할 수 있습니다.", True),
    "FILE_TOO_LARGE": (413, "파일이 너무 큽니다 (최대 업로드 크기 초과).", True),
    "UNSUPPORTED_FORMAT": (415, "이 파일은 열 수 없습니다 (암호화되었거나 손상되었을 수 있음).", True),
    "CONVERTER_ERROR": (500, "문서 변환 중 문제가 생겼습니다. 새로고침 후 다시 시도하거나, 담당자에게 파일을 공유해 주세요.", True),
    "INVALID_BLOCKS": (400, "저장 형식이 올바르지 않습니다. 페이지를 다시 로드해 주세요.", False),
    "UPLOAD_EXPIRED": (404, "원본 업로드 세션이 만료되었습니다. 파일을 다시 업로드하거나 단순화 저장을 계속 진행하세요.", True),
    "AUTH_ERROR": (401, "AI 서비스 인증에 실패했습니다. 관리자에게 문의하세요.", False),
    "RATE_LIMITED": (429, "요청이 너무 많습니다. 잠시 후 다시 시도하세요.", True),
    "UPSTREAM_UNAVAILABLE": (503, "AI 서비스가 응답하지 않습니다. 잠시 후 다시 시도하세요.", True),
    "NETWORK_ERROR": (502, "인터넷 연결을 확인해 주세요.", True),
    "JSON_PARSE_FAILED": (502, "AI 응답을 이해하지 못했습니다. 다시 시도하거나 요청을 단순화해 주세요.", True),
}


def app_error(
    code: ErrorCode,
    detail: str | None = None,
    message_override: str | None = None,
) -> HTTPException:
    """Build a FastAPI HTTPException whose body matches Design §6.2."""
    status, message, recoverable = _CATALOG[code]
    payload = ErrorPayload(
        code=code,
        message=message_override or message,
        detail=detail,
        recoverable=recoverable,
    )
    return HTTPException(status_code=status, detail=ErrorEnvelope(error=payload).model_dump())
