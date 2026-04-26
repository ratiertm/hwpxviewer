"""hwpx skill loader + intent-aware system prompt composer.

Reads ``~/.claude/skills/hwpx/SKILL.md`` and selected reference files into
process memory once (``@cache``). The skill content is **never executed** —
Claude runs in the existing isolated mode (no tools, no slash commands).
Instead, the relevant slice is injected into the system prompt so the model
emits a JSON DocumentPlan that the backend then dispatches into pyhwpxlib.

Strategy (matches the agreed design):
- HWPX_CORE_RULES — always sent (~750 tokens). Hand-curated subset of
  SKILL.md "절대 규칙" + "디자인 규칙" + theme list.
- references/<name>.md — sent only for the matching intent.
- The full SKILL.md is also exposed via ``load_skill_md()`` for tests/diagnostics
  but NOT inlined by default to keep token cost predictable.
"""

from __future__ import annotations

import os
from functools import cache
from pathlib import Path
from typing import Literal

Intent = Literal["new_doc", "gongmun", "form_fill", "edit", "convert"]

ALL_INTENTS: tuple[Intent, ...] = ("new_doc", "gongmun", "form_fill", "edit", "convert")


def _skill_dir() -> Path:
    """Resolve skill install dir. Override with ``HWPX_SKILL_DIR`` for tests."""
    override = os.getenv("HWPX_SKILL_DIR")
    if override:
        return Path(override)
    return Path.home() / ".claude" / "skills" / "hwpx"


@cache
def load_skill_md() -> str:
    p = _skill_dir() / "SKILL.md"
    return p.read_text(encoding="utf-8") if p.exists() else ""


@cache
def load_reference(name: str) -> str:
    """Load a single reference file by stem (no .md). Returns "" if missing."""
    p = _skill_dir() / "references" / f"{name}.md"
    return p.read_text(encoding="utf-8") if p.exists() else ""


# Hand-curated core. Distilled from SKILL.md so we never balloon the prompt.
HWPX_CORE_RULES = """\
[hwpx 스킬 핵심 규칙 — 너는 한국어 HWPX 문서 생성 플래너다]

## 너의 역할
- pyhwpxlib 라이브러리는 백엔드가 직접 호출한다. 너는 도구를 쓰지 않는다.
- 너는 사용자 요청을 분석해 아래 스키마의 JSON 한 덩이만 출력한다.
- 코드 펜스 없이, 다른 설명 없이, 오직 JSON.

## 출력 스키마
{
  "intent": "new_doc" | "gongmun" | "form_fill" | "edit" | "convert",
  "theme": "default" | "forest" | "warm_executive" | "ocean_analytics"
         | "coral_energy" | "charcoal_minimal" | "teal_trust"
         | "berry_cream" | "sage_calm" | "cherry_bold",
  "title": "문서 제목 (선택)",
  "blocks": [
    { "type": "heading",   "level": 1|2|3, "text": "..." },
    { "type": "paragraph", "text": "..." },
    { "type": "spacer" },
    { "type": "table",     "headers": ["..."], "rows": [["..."], ...] },
    { "type": "bullet_list",   "items": ["..."] },
    { "type": "numbered_list", "items": ["..."] }
  ],
  "gongmun": null | { ... gongmun 의도일 때만 ... }
}

## 디자인 규칙 (반드시 준수)
1. 주제에 맞는 테마 선택 — 파란색 디폴트는 일반 공문서/보고서일 때만.
2. 헤딩/표/이미지 앞뒤에 반드시 ``{"type":"spacer"}``.
3. 표는 내용에 맞을 때만. 텍스트만으로 충분한 섹션에 억지 표 금지.
4. 같은 레이아웃 반복 금지 — 단조로운 paragraph 나열만 하지 말 것.
5. 격식 있는 한국어 공공/기업 문서 톤. 구어체 금지.
6. ``\\n`` 을 text 안에 넣지 말 것 — 줄을 나누려면 paragraph 를 분리.

## 테마 10종
| 테마 | Primary | 용도 |
|------|---------|------|
| default          | #395da2 | 일반 공문서 |
| forest           | #2C5F2D | 환경, ESG, 지속가능성 |
| warm_executive   | #B85042 | 제안서, 임원 보고 |
| ocean_analytics  | #065A82 | 데이터, 분석 보고 |
| coral_energy     | #F96167 | 마케팅, 캠페인 |
| charcoal_minimal | #36454F | 기술 문서 |
| teal_trust       | #028090 | 의료, 금융 |
| berry_cream      | #6D2E46 | 교육, 인문 |
| sage_calm        | #84B59F | 웰빙, 케어 |
| cherry_bold      | #990011 | 경고, 주의 |

## intent 의미
- new_doc:   사용자가 자유 형식 문서를 만들어 달라고 함
- gongmun:   행정안전부 편람을 따르는 공문/기안문
- form_fill: 기존 양식의 빈칸 채우기
- edit:      기존 문서 부분 수정 (이 모드는 백엔드가 별도 라우팅)
- convert:   포맷 변환 (md/html/hwp → hwpx)
"""


# intent → references 매핑 (필요할 때만 로드)
_REFERENCE_MAP: dict[str, tuple[str, ...]] = {
    "new_doc":   ("design_guide",),       # 11KB — 팔레트 + 레이아웃
    "gongmun":   ("gongmun",),            # 10KB — 편람 규정
    "form_fill": ("form_automation",),    # 9KB
    "edit":      ("editing",),            # 10KB
    "convert":   (),                      # 코어만
}


# gongmun 전용 추가 스키마 안내 (intent=gongmun 일 때만 추가)
_GONGMUN_SCHEMA = """\
## gongmun 의도일 때 추가 필드
"gongmun": {
  "기관명": "행정안전부",
  "수신": "수신자 참조 또는 '내부결재'",
  "제목": "...",
  "본문": ["문단1", "문단2"],
  "붙임": ["계획서 1부."],
  "발신명의": "행정안전부장관",
  "기안자": {"직위": "행정사무관", "이름": "김OO"},
  "결재권자": {"직위": "정보공개과장", "이름": "김OO", "전결": true,
              "서명일자": "2025. 9. 30."},
  "시행_처리과명": "정보공개과",
  "시행_일련번호": "000",
  "시행일": "2025. 9. 30.",
  "우편번호": "30112",
  "도로명주소": "세종특별자치시 도움6로 42",
  "전화": "(044)205-0000",
  "공개구분": "대국민공개"
}

규칙:
- 날짜는 ``YYYY. M. D.`` (마침표 + 공백) 형식
- "할 것", "~바람" 같은 위압적 어투 금지
- "치하했다" 같은 권위적 표현 금지
- 본문 항목은 자동 1. 2. 3. 번호 부여되므로 번호 직접 쓰지 말 것
"""


def compose_system_prompt(intent: str = "new_doc") -> str:
    """Compose the system prompt for ``/api/generate``.

    Always includes ``HWPX_CORE_RULES``. Adds intent-specific reference
    content when available. For ``gongmun``, also appends the
    structured-field schema so Claude fills the dedicated section.
    """
    parts: list[str] = [HWPX_CORE_RULES]
    for ref in _REFERENCE_MAP.get(intent, ()):
        body = load_reference(ref)
        if body:
            parts.append(f"---\n\n[참고: references/{ref}.md]\n\n{body}")
    if intent == "gongmun":
        parts.append(_GONGMUN_SCHEMA)
    return "\n\n".join(parts)


def healthcheck() -> dict[str, bool | str]:
    """Used by /healthz/ready to verify the skill is installed."""
    skill_md = _skill_dir() / "SKILL.md"
    return {
        "skill_dir": str(_skill_dir()),
        "skill_md_present": skill_md.exists(),
    }
