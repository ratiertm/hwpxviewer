"""DocumentPlan → pyhwpxlib bytes.

The Claude planner emits a structured ``DocumentPlan`` (see ``schemas``).
This module is the **only** place that translates a plan into actual
``HwpxBuilder`` / ``GongmunBuilder`` calls. Pure-ish: input plan + theme,
output is the bytes of a saved .hwpx file. No I/O outside a single
tempfile (pyhwpxlib's save() expects a path).

Key invariants enforced here, NOT trusted from Claude:
- Every heading/table is sandwiched by empty paragraphs (SKILL.md rule).
- Theme name is whitelisted against ``BUILTIN_THEMES``; falls back to default.
- Cell rows are length-padded to header width to avoid pyhwpxlib XML errors.
"""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path

from pyhwpxlib import BUILTIN_THEMES, HwpxBuilder
from pyhwpxlib.gongmun import (
    Gongmun,
    GongmunBuilder,
    signer,
    validate_file,
)

from ..schemas import (
    DocumentPlan,
    GongmunSpec,
    PlanBlock,
    PlanBlockBullet,
    PlanBlockHeading,
    PlanBlockNumbered,
    PlanBlockParagraph,
    PlanBlockSpacer,
    PlanBlockTable,
)

logger = logging.getLogger(__name__)


_VALID_THEMES = set(BUILTIN_THEMES.keys()) if hasattr(BUILTIN_THEMES, "keys") else {
    "default", "forest", "warm_executive", "ocean_analytics", "coral_energy",
    "charcoal_minimal", "teal_trust", "berry_cream", "sage_calm", "cherry_bold",
}


def _normalize_theme(theme: str | None) -> str:
    if theme and theme in _VALID_THEMES:
        return theme
    return "default"


def _pad_rows(headers: list[str] | None, rows: list[list[str]]) -> tuple[list[str], list[list[str]]]:
    """Ensure every row has the same column count as headers (or row 0)."""
    width = len(headers) if headers else (len(rows[0]) if rows else 0)
    if width == 0:
        return ["내용"], [["(빈 표)"]]
    padded = [list(r) + [""] * (width - len(r)) for r in rows]
    padded = [r[:width] for r in padded]
    if not headers:
        # Use first row as headers if Claude didn't provide any.
        return padded[0], padded[1:] or [[""] * width]
    return list(headers), padded


# ---- Block dispatch --------------------------------------------------------


def _apply_block(builder: HwpxBuilder, block: PlanBlock) -> None:
    if isinstance(block, PlanBlockHeading):
        builder.add_paragraph("")  # spacer before
        builder.add_heading(block.text, level=max(1, min(6, block.level)))
        builder.add_paragraph("")  # spacer after
        return
    if isinstance(block, PlanBlockParagraph):
        text = block.text.replace("\n", " ").strip()
        if not text:
            return
        builder.add_paragraph(
            text,
            bold=bool(block.bold),
            italic=bool(block.italic),
            font_size=block.font_size,
            alignment=block.alignment or "JUSTIFY",
        )
        return
    if isinstance(block, PlanBlockSpacer):
        builder.add_paragraph("")
        return
    if isinstance(block, PlanBlockTable):
        headers, rows = _pad_rows(list(block.headers) if block.headers else None, [list(r) for r in block.rows])
        data = [headers] + rows
        builder.add_paragraph("")
        builder.add_table(data)
        builder.add_paragraph("")
        return
    if isinstance(block, PlanBlockBullet):
        for item in block.items:
            text = item.strip()
            if text:
                builder.add_paragraph(f"• {text}")
        return
    if isinstance(block, PlanBlockNumbered):
        for idx, item in enumerate(block.items, 1):
            text = item.strip()
            if text:
                builder.add_paragraph(f"{idx}. {text}")
        return
    logger.warning("plan_dispatcher.unknown_block", extra={"type": getattr(block, "type", None)})


# ---- Public API ------------------------------------------------------------


def render_plan_to_path(plan: DocumentPlan, out_path: Path) -> Path:
    """Materialize ``plan`` as a .hwpx file at ``out_path``. Returns the path.

    For ``intent == "gongmun"`` and a non-null ``gongmun`` field, uses
    GongmunBuilder which adds 행정안전부 편람 compliance. Otherwise builds
    a generic document with ``HwpxBuilder``.
    """
    theme = _normalize_theme(plan.theme)

    if plan.intent == "gongmun" and plan.gongmun is not None:
        return _render_gongmun(plan.gongmun, theme, out_path)

    builder = HwpxBuilder(theme=theme)

    if plan.title:
        builder.add_heading(plan.title, level=1)
        builder.add_paragraph("")

    for block in plan.blocks:
        try:
            _apply_block(builder, block)
        except Exception:
            logger.exception("plan_dispatcher.block_failed", extra={"type": getattr(block, "type", None)})

    builder.save(str(out_path))
    return out_path


def _render_gongmun(spec: GongmunSpec, theme: str, out_path: Path) -> Path:
    """Build a 공문(기안문) via GongmunBuilder. Falls back gracefully on missing fields."""
    kwargs: dict = {
        "기관명": spec.기관명 or "",
        "수신": spec.수신 or "내부결재",
        "제목": spec.제목 or "",
        "본문": list(spec.본문 or []),
        "발신명의": spec.발신명의 or spec.기관명 or "",
    }
    if spec.붙임:
        kwargs["붙임"] = list(spec.붙임)
    if spec.기안자 and spec.기안자.이름:
        kwargs["기안자"] = signer(spec.기안자.직위 or "", spec.기안자.이름)
    if spec.결재권자 and spec.결재권자.이름:
        kwargs["결재권자"] = signer(
            spec.결재권자.직위 or "",
            spec.결재권자.이름,
            전결=bool(spec.결재권자.전결),
            **({"서명일자": spec.결재권자.서명일자} if spec.결재권자.서명일자 else {}),
        )
    for attr in (
        "시행_처리과명",
        "시행_일련번호",
        "시행일",
        "우편번호",
        "도로명주소",
        "전화",
        "공개구분",
    ):
        v = getattr(spec, attr, None)
        if v:
            kwargs[attr] = v

    doc = Gongmun(**kwargs)
    GongmunBuilder(doc, theme=theme).save(str(out_path))
    return out_path


def validate_generated(path: Path) -> dict[str, list[str]]:
    """Run pyhwpxlib's gongmun validator (works on any HWPX). Returns
    {errors, warnings, info} so the SSE stream can surface issues.

    Non-fatal: returns empty buckets if the validator itself raises.
    """
    try:
        report = validate_file(str(path))
    except Exception as e:
        logger.warning("plan_dispatcher.validate_skipped: %s", e)
        return {"errors": [], "warnings": [], "info": []}

    out: dict[str, list[str]] = {"errors": [], "warnings": [], "info": []}
    for item in report or []:
        sev = (getattr(item, "severity", None) or item.get("severity", "")).lower()
        msg = getattr(item, "message", None) or item.get("message", "")
        if sev == "error":
            out["errors"].append(msg)
        elif sev == "warning":
            out["warnings"].append(msg)
        else:
            out["info"].append(msg)
    return out


def temp_output_path(prefix: str = "hwpx-gen-") -> Path:
    """Allocate a unique tempfile path. Caller is responsible for cleanup."""
    fd, name = tempfile.mkstemp(prefix=prefix, suffix=".hwpx")
    import os
    os.close(fd)
    return Path(name)
