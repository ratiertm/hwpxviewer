"""Smoke tests for prompts module — ensures the verbatim port stays verbatim."""

from __future__ import annotations

import pytest

from hwpx_viewer_api.prompts import (
    SYSTEM_DOC_EDITOR,
    SYSTEM_INLINE_EDITOR,
    get_prompt,
    valid_prompt_ids,
)


def test_doc_editor_prompt_has_required_sections() -> None:
    assert "JSON" in SYSTEM_DOC_EDITOR
    assert "summary" in SYSTEM_DOC_EDITOR
    assert "edits" in SYSTEM_DOC_EDITOR
    assert "table" in SYSTEM_DOC_EDITOR
    # Block types frozen per ARCHITECTURE.md §2.2.
    for t in ["h1", "h2", "lead", "p", "table"]:
        assert t in SYSTEM_DOC_EDITOR


def test_inline_editor_prompt_has_required_actions() -> None:
    for action in ["rewrite", "shorten", "translate"]:
        assert action in SYSTEM_INLINE_EDITOR
    assert "newText" in SYSTEM_INLINE_EDITOR


def test_get_prompt_known_ids() -> None:
    assert get_prompt("doc_editor") == SYSTEM_DOC_EDITOR
    assert get_prompt("inline_editor") == SYSTEM_INLINE_EDITOR


def test_valid_prompt_ids() -> None:
    ids = valid_prompt_ids()
    assert "doc_editor" in ids
    assert "inline_editor" in ids
    assert len(ids) == 2


def test_get_prompt_unknown_raises() -> None:
    with pytest.raises(KeyError):
        get_prompt("unknown")  # type: ignore[arg-type]
