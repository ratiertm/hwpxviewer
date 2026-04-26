"""rhwp WASM service — single shared engine + per-upload document sessions.

Design v0.3 §5. Wraps pyhwpxlib's RhwpEngine (wasmtime-based) and exposes the
editing + hit-test API needed by the viewer.

pyhwpxlib's RhwpDocument only surfaces ``render_page_svg`` publicly; here we
reach into ``_engine._exports`` to also call ``hitTest``, ``insertText``,
``deleteText``, ``getSelectionRects``, ``getTextRange``, ``save`` — exactly the
set Design v0.3 requires.

Concurrency
-----------
wasmtime instances are not thread-safe. We serialize **all** engine calls with
a single ``threading.Lock``. For v1.0 single-user this is fine; v2.0 multi-user
will shard to a pool of engines.
"""

from __future__ import annotations

import ctypes
import json
import logging
import threading
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lazy, process-wide engine
# ---------------------------------------------------------------------------


_engine_lock = threading.Lock()
_engine_instance: "Optional[_BackedEngine]" = None


def get_engine() -> "_BackedEngine":
    """Return the shared rhwp engine, loading the WASM binary on first call."""
    global _engine_instance
    with _engine_lock:
        if _engine_instance is None:
            _engine_instance = _BackedEngine()
        return _engine_instance


class _BackedEngine:
    """Thin wrapper around ``pyhwpxlib.rhwp_bridge.RhwpEngine``.

    We own the ``threading.Lock`` that serializes ALL document operations
    (render, hit_test, edit, save) — wasmtime cannot be called concurrently.
    """

    def __init__(self) -> None:
        # Import inside ctor so tests without [preview] installed still import
        # this module.
        from pyhwpxlib.rhwp_bridge import RhwpEngine

        self._inner = RhwpEngine()
        self._lock = threading.Lock()
        logger.info("rhwp.engine.loaded", extra={"wasm_path": str(self._inner._wasm_path)})

    # ----- factory -------------------------------------------------------

    def load_document_bytes(self, data: bytes, *, name: str) -> "DocumentSession":
        """Load HWPX bytes into the rhwp engine and keep the original bytes.

        The original HWPX is retained so ``save_hwpx_bytes`` can return a
        real .hwpx (not HWP 5.x). When the edit pipeline lands in M6R this
        is extended by a parallel ``pyhwpxlib.json_io`` IR so edits apply
        to both the rhwp in-memory document (for re-rendering) and the
        JSON tree (for ``HwpxBuilder`` re-emit).
        """
        with self._lock:
            doc = self._inner.load_bytes(data, name=name)
        return DocumentSession(self, doc, name=name, original_bytes=data)


# ---------------------------------------------------------------------------
# DocumentSession — per-upload state
# ---------------------------------------------------------------------------


class DocumentSession:
    """One loaded HWPX. Operations are serialized via the shared engine lock."""

    def __init__(
        self,
        engine: _BackedEngine,
        doc: Any,
        *,
        name: str,
        original_bytes: bytes,
    ) -> None:
        self._engine = engine
        self._doc = doc           # pyhwpxlib.rhwp_bridge.RhwpDocument
        self._exports = doc._engine._exports
        self._store = doc._engine._store
        self._memory = doc._engine._memory
        self._handle = doc._handle
        self.name = name
        self.version = 0
        self._closed = False
        # Original HWPX bytes — returned by save_hwpx_bytes until edit-aware
        # JSON round-trip lands (pyhwpxlib HwpxBuilder path).
        self._original_bytes = original_bytes
        # Populated lazily on first edit via ``pyhwpxlib.json_io.to_json``.
        self._json_ir: Optional[dict[str, Any]] = None
        # M6R edit history — list of dicts {id, selection, oldText, newText, undone}
        self.edits: list[dict[str, Any]] = []
        self._next_edit_id = 1

    # ----- pure-read API --------------------------------------------------

    @property
    def page_count(self) -> int:
        with self._engine._lock:
            return int(self._doc.page_count)

    def render_page_svg(self, page: int, *, embed_fonts: bool = True) -> str:
        """Render one page to SVG with Korean fonts embedded by default.

        Fonts are **always** embedded (base64 subset) so the SVG renders
        identically across every browser, container, and offline environment —
        Korean users must never see tofu glyphs. Pass ``embed_fonts=False``
        only for debug / size-profiling.
        """
        with self._engine._lock:
            return self._doc.render_page_svg(page, embed_fonts=embed_fonts)

    # ----- save / round-trip --------------------------------------------

    def save_hwpx_bytes(self) -> bytes:
        """Return the current document state as HWPX bytes.

        Strategy: replay the non-undone edit log directly against the
        original HWPX XML (see ``services/hwpx_patcher.py``). This preserves
        every unedited byte — embedded images, custom metadata, font tables,
        namespace declarations — and only modifies the ``<hp:t>`` text values
        inside the runs that were actually edited.

        Design v0.3 note: we intentionally avoid the previous
        rhwp → HWP 5.x → hwp2hwpx round-trip, which lost HWPX-only metadata.
        rhwp remains the source of truth for *rendering*; the patcher owns
        *persistence*.
        """
        effective = [e for e in self.edits if not e["undone"]]
        if not effective:
            return self._original_bytes
        from .hwpx_patcher import apply_edits_to_hwpx
        return apply_edits_to_hwpx(self._original_bytes, self.edits)

    # ----- edit / hit-test API (direct WASM exports) ----------------------

    def hit_test(self, page: int, x: float, y: float) -> Optional[dict[str, int]]:
        """(x, y) → {sec, para, charOffset} or None.

        Returns ``None`` if the point is outside any text run.
        """
        result = self._call_json("hwpdocument_hitTest", self._handle, page, x, y)
        if not result:
            return None
        # rhwp returns something like {"sectionIndex":0,"paraIndex":3,"charOffset":5, ...}
        # We normalize the key names for the viewer API.
        return _normalize_location(result)

    def get_text_range(
        self,
        sec: int,
        para: int,
        char_offset: int,
        count: int,
        cell: Optional[dict[str, int]] = None,
    ) -> str:
        """Return the substring at (sec, para, charOffset) of length count.

        When ``cell`` is provided the call is routed to
        ``hwpdocument_getTextInCell`` with ``(parentParaIndex, controlIndex,
        cellIndex, cellParaIndex=para)`` — rhwp's dedicated export for
        table-cell text.
        """
        if cell is not None:
            result = self._call_json(
                "hwpdocument_getTextInCell",
                self._handle,
                sec,
                int(cell["parentParaIndex"]),
                int(cell["controlIndex"]),
                int(cell["cellIndex"]),
                para,
                char_offset,
                count,
            )
        else:
            result = self._call_json(
                "hwpdocument_getTextRange", self._handle, sec, para, char_offset, count,
            )
        if isinstance(result, dict):
            return str(result.get("text", ""))
        return str(result or "")

    def get_paragraph_length(
        self,
        sec: int,
        para: int,
        cell: Optional[dict[str, int]] = None,
    ) -> int:
        """Return the character length of a paragraph — used by click-to-select
        to expand a single hit-test into a paragraph-wide Selection.

        For table cells, routes to ``hwpdocument_getCellParagraphLength`` with
        ``(parentParaIndex, controlIndex, cellIndex, cellParaIndex=para)``.
        """
        if cell is not None:
            export_name = "hwpdocument_getCellParagraphLength"
            export = self._exports.get(export_name)
            if export is None:
                raise RuntimeError(f"rhwp WASM export missing: {export_name}")
            with self._engine._lock:
                ret = export(
                    self._store,
                    self._handle,
                    sec,
                    int(cell["parentParaIndex"]),
                    int(cell["controlIndex"]),
                    int(cell["cellIndex"]),
                    para,
                )
        else:
            export = self._exports.get("hwpdocument_getParagraphLength")
            if export is None:
                raise RuntimeError("rhwp WASM export missing: hwpdocument_getParagraphLength")
            with self._engine._lock:
                ret = export(self._store, self._handle, sec, para)
        # Export returns u32 directly (wasm_bindgen throws on the Err side,
        # so success is a bare int).
        if isinstance(ret, (tuple, list)):
            return int(ret[0])
        return int(ret)

    # ----- cross-paragraph range helpers (M7R multi-row) -----------------

    def get_text_across(
        self,
        sec: int,
        start_para: int,
        start_char_offset: int,
        end_para: int,
        end_char_offset: int,
        cell: Optional[dict[str, int]] = None,
    ) -> str:
        """Concatenate text across paragraphs for a cross-para selection.

        rhwp's ``getTextRange`` is single-paragraph only, so we iterate
        paragraphs and stitch. ``\\n`` joins preserve legibility in chat
        attachments and in the edit log's ``oldText`` snapshot — not in the
        HWPX save path (the XML patcher collapses paragraphs on apply).
        """
        if start_para == end_para:
            return self.get_text_range(
                sec, start_para, start_char_offset,
                end_char_offset - start_char_offset, cell=cell,
            )
        parts: list[str] = []
        # first paragraph: from start_char_offset to end of paragraph
        first_len = self.get_paragraph_length(sec, start_para, cell=cell) - start_char_offset
        if first_len > 0:
            parts.append(self.get_text_range(sec, start_para, start_char_offset, first_len, cell=cell))
        # middle paragraphs: whole text
        for p in range(start_para + 1, end_para):
            plen = self.get_paragraph_length(sec, p, cell=cell)
            parts.append(self.get_text_range(sec, p, 0, plen, cell=cell) if plen > 0 else "")
        # last paragraph: from 0 to end_char_offset
        if end_char_offset > 0:
            parts.append(self.get_text_range(sec, end_para, 0, end_char_offset, cell=cell))
        return "\n".join(parts)

    def delete_range(
        self,
        sec: int,
        start_para: int,
        start_char_offset: int,
        end_para: int,
        end_char_offset: int,
        cell: Optional[dict[str, int]] = None,
    ) -> dict[str, Any]:
        """Delete a cross-paragraph range via rhwp's ``deleteRange`` export.

        rhwp collapses the affected paragraphs into one after the call. The
        XML patcher mirrors this by removing the trailing paragraphs and
        merging remainders into the start paragraph on save.
        """
        if cell is not None:
            return self._call_json(
                "hwpdocument_deleteRangeInCell",
                self._handle,
                sec,
                int(cell["parentParaIndex"]),
                int(cell["controlIndex"]),
                int(cell["cellIndex"]),
                start_para,
                start_char_offset,
                end_para,
                end_char_offset,
            ) or {}
        return self._call_json(
            "hwpdocument_deleteRange",
            self._handle,
            sec,
            start_para,
            start_char_offset,
            end_para,
            end_char_offset,
        ) or {}

    def get_selection_rects(
        self,
        sec: int,
        start_para: int,
        start_char_offset: int,
        end_para: int,
        end_char_offset: int,
        cell: Optional[dict[str, int]] = None,
    ) -> list[dict[str, float]]:
        """Return pixel rectangles covering a selection. One rect per visual line.

        For same-paragraph ranges we call rhwp's native ``getSelectionRects``
        directly. For **cross-paragraph** ranges we DON'T — rhwp was
        empirically observed to drop the leading heading's rect when the
        start paragraph has a heading ``paraPrIDRef`` (user report
        2026-04-25, textLen=244 with visible heading in text but 6 rects
        covering only the body). Instead we fan out per paragraph and
        concatenate the results so every line in the range is represented.
        """
        if start_para == end_para:
            rects = self._call_selection_rects(
                sec, start_para, start_char_offset, end_para, end_char_offset, cell=cell,
            )
        else:
            rects = []
            # First paragraph: from start_char_offset to end of paragraph.
            first_len = self.get_paragraph_length(sec, start_para, cell=cell)
            if first_len > start_char_offset:
                rects.extend(
                    self._call_selection_rects(
                        sec, start_para, start_char_offset, start_para, first_len, cell=cell,
                    )
                )
            # Middle paragraphs: full paragraph.
            for p in range(start_para + 1, end_para):
                plen = self.get_paragraph_length(sec, p, cell=cell)
                if plen > 0:
                    rects.extend(
                        self._call_selection_rects(sec, p, 0, p, plen, cell=cell)
                    )
            # End paragraph: from 0 to end_char_offset.
            if end_char_offset > 0:
                rects.extend(
                    self._call_selection_rects(
                        sec, end_para, 0, end_para, end_char_offset, cell=cell,
                    )
                )
        # ---- Step 1: dedup --------------------------------------------------
        # rhwp empirically duplicates one rect in some selections.
        seen: set[tuple[int, int, int, int, int]] = set()
        unique: list[dict[str, float]] = []
        for r in rects:
            key = (
                int(r["page"]),
                round(r["x"]),
                round(r["y"]),
                round(r["width"]),
                round(r["height"]),
            )
            if key in seen:
                continue
            seen.add(key)
            unique.append(r)

        # ---- Step 2: detect & synthesize missing line(s) via cursor-rect ----
        # Probe rhwp's cursor positions at the selection START and just BEFORE
        # the selection END. Any visible line that doesn't already have a rect
        # gets one synthesized from the cursor-rect data. This recovers
        # paragraphs where rhwp's getSelectionRects dropped the leading or
        # trailing line (user report 2026-04-25 — 5 lines selected, rhwp
        # returned 4 unique rects + 1 duplicate, missing the tail line).
        if start_para == end_para:
            # Single paragraph: probe start + (end-1).
            self._augment_missing_lines(
                unique,
                sec=sec,
                start_para=start_para,
                start_char_offset=start_char_offset,
                end_para=end_para,
                end_char_offset=end_char_offset,
                cell=cell,
            )
        else:
            # Cross paragraph: each paragraph already went through fanout.
            # Probe start of first paragraph and end of last paragraph.
            self._augment_missing_lines(
                unique,
                sec=sec,
                start_para=start_para,
                start_char_offset=start_char_offset,
                end_para=end_para,
                end_char_offset=end_char_offset,
                cell=cell,
            )
        return unique

    def _augment_missing_lines(
        self,
        rects: list[dict[str, float]],
        *,
        sec: int,
        start_para: int,
        start_char_offset: int,
        end_para: int,
        end_char_offset: int,
        cell: Optional[dict[str, int]] = None,
    ) -> None:
        """Sweep cursor-rect across **every paragraph** in the selection and
        synthesize a rect for any visual line not yet covered.

        Replaces the previous boundary-only probe (2026-04-25) which missed
        dropped middle lines on rhwp's getSelectionRects in some
        environments. The sweep walks each paragraph at ~3-char increments,
        collects distinct (page, y) positions seen by getCursorRect, and
        appends a synthetic rect for any (page, y) absent from ``rects``.

        rhwp's cursor-rect calls are cheap (≤ 5µs each on M-series), so even
        a 500-char paragraph sweep at step=3 is ~170 calls < 1 ms.
        """
        # Step size in chars between cursor probes. Smaller = finer resolution
        # but more WASM calls. 3 chars catches any line wrap that occurs at
        # word boundaries (Korean public documents use ~30-40 char lines).
        STEP = 3

        typical_width = max((r["width"] for r in rects), default=0.0)
        typical_x = min((r["x"] for r in rects), default=0.0)
        typical_height = max((r["height"] for r in rects), default=0.0)
        # Use the GLYPH height (≈ rect height) as our line-merge tolerance,
        # not _line_spacing(rects) — that would be doubled when rhwp drops a
        # line, which causes adjacent visual lines to be falsely merged into
        # one entry. Glyph height is always an over-approximation safe to use.
        # Default to 8px so very short selections still get a sensible value.
        merge_tol = max(typical_height * 0.6, 8.0) if typical_height > 0 else 8.0

        def _has_line_at(page: int, y: float) -> bool:
            for r in rects:
                if int(r["page"]) != page:
                    continue
                if abs(float(r["y"]) - y) <= merge_tol:
                    return True
            return False

        # Collect all (page, y) cursor positions across the selection.
        seen_lines: list[tuple[int, float, float, float]] = []
        # entries: (page, y, min_x, height)

        def _record(page: int, y: float, x: float, h: float) -> None:
            for i, (p, ey, ex, eh) in enumerate(seen_lines):
                if p == page and abs(ey - y) <= merge_tol:
                    # Same line — keep the leftmost x and tallest height.
                    seen_lines[i] = (p, ey, min(ex, x), max(eh, h))
                    return
            seen_lines.append((page, y, x, h))

        for para in range(start_para, end_para + 1):
            try:
                plen = self.get_paragraph_length(sec, para, cell=cell)
            except Exception:  # noqa: BLE001
                continue
            lo = start_char_offset if para == start_para else 0
            hi = end_char_offset if para == end_para else plen
            if hi <= lo:
                # Edge case: end_char_offset==0 on a multi-para selection.
                # Still probe the start position so we don't miss the line.
                hi = lo + 1
            # Generate offsets to probe: every STEP chars + lo + (hi-1).
            offsets = list(range(lo, hi, STEP))
            if hi - 1 not in offsets:
                offsets.append(hi - 1)
            if lo not in offsets:
                offsets.insert(0, lo)
            for off in offsets:
                if off < 0 or off > plen:
                    continue
                try:
                    cur = self.get_cursor_rect(sec, para, off, cell=cell)
                except Exception:  # noqa: BLE001
                    continue
                if cur is None:
                    continue
                _record(
                    int(cur["page"]),
                    float(cur["y"]),
                    float(cur["x"]),
                    float(cur.get("height", typical_height)),
                )

        # For each distinct line discovered, append a synthetic rect if not
        # already covered by ``rects``.
        for page, y, min_x, h in seen_lines:
            if _has_line_at(page, y):
                continue
            rects.append({
                "page": page,
                "x": typical_x or min_x,
                "y": y,
                # Width: full line if we have a typical width, else fall back
                # to typical width * 0.6 so the synthesized rect is visible.
                "width": typical_width if typical_width > 0 else 200.0,
                "height": h or typical_height or 16.0,
            })

    def _call_selection_rects(
        self,
        sec: int,
        start_para: int,
        start_char_offset: int,
        end_para: int,
        end_char_offset: int,
        cell: Optional[dict[str, int]] = None,
    ) -> list[dict[str, float]]:
        """Raw single-call dispatch to rhwp's selection-rects export."""
        if cell is not None:
            result = self._call_json(
                "hwpdocument_getSelectionRectsInCell",
                self._handle,
                sec,
                int(cell["parentParaIndex"]),
                int(cell["controlIndex"]),
                int(cell["cellIndex"]),
                start_para,
                start_char_offset,
                end_para,
                end_char_offset,
            )
        else:
            result = self._call_json(
                "hwpdocument_getSelectionRects",
                self._handle, sec, start_para, start_char_offset, end_para, end_char_offset,
            )
        if isinstance(result, list):
            return [_normalize_rect(r) for r in result]
        return []

    def get_cursor_rect(
        self,
        sec: int,
        para: int,
        char_offset: int,
        cell: Optional[dict[str, int]] = None,
    ) -> Optional[dict[str, float]]:
        """Caret position rect at ``(sec, para, char_offset)``.

        rhwp's ``getCursorRect`` returns ``{pageIndex, x, y, height}`` —
        same coord system as ``getSelectionRects``. Used as a ground-truth
        probe to detect lines that ``getSelectionRects`` missed.
        """
        if cell is not None:
            export_name = "hwpdocument_getCursorRectInCell"
            if export_name not in self._exports:
                return None
            result = self._call_json(
                export_name,
                self._handle,
                sec,
                int(cell["parentParaIndex"]),
                int(cell["controlIndex"]),
                int(cell["cellIndex"]),
                para,
                char_offset,
            )
        else:
            export_name = "hwpdocument_getCursorRect"
            if export_name not in self._exports:
                return None
            result = self._call_json(export_name, self._handle, sec, para, char_offset)
        if not isinstance(result, dict):
            return None
        return {
            "page": int(result.get("pageIndex", result.get("page", 0))),
            "x": float(result.get("x", 0.0)),
            "y": float(result.get("y", 0.0)),
            "height": float(result.get("height", result.get("h", 0.0))),
        }

    def insert_text(
        self,
        sec: int,
        para: int,
        char_offset: int,
        text: str,
        cell: Optional[dict[str, int]] = None,
    ) -> dict[str, Any]:
        """Insert ``text`` at (sec, para, charOffset). Returns rhwp ack JSON."""
        if cell is not None:
            return self._call_json_with_string(
                "hwpdocument_insertTextInCell",
                text,
                self._handle,
                sec,
                int(cell["parentParaIndex"]),
                int(cell["controlIndex"]),
                int(cell["cellIndex"]),
                para,
                char_offset,
            ) or {}
        return self._call_json_with_string(
            "hwpdocument_insertText", text, self._handle, sec, para, char_offset,
        ) or {}

    def delete_text(
        self,
        sec: int,
        para: int,
        char_offset: int,
        count: int,
        cell: Optional[dict[str, int]] = None,
    ) -> dict[str, Any]:
        """Delete ``count`` chars starting at (sec, para, charOffset)."""
        if cell is not None:
            return self._call_json(
                "hwpdocument_deleteTextInCell",
                self._handle,
                sec,
                int(cell["parentParaIndex"]),
                int(cell["controlIndex"]),
                int(cell["cellIndex"]),
                para,
                char_offset,
                count,
            ) or {}
        return self._call_json(
            "hwpdocument_deleteText", self._handle, sec, para, char_offset, count,
        ) or {}

    # ----- higher-level edit (M6R) --------------------------------------

    def apply_edit(
        self,
        sec: int,
        para: int,
        char_offset: int,
        length: int,
        new_text: str,
        cell: Optional[dict[str, int]] = None,
        *,
        end_para: Optional[int] = None,
        end_char_offset: Optional[int] = None,
    ) -> dict[str, Any]:
        """Replace the selected range with ``new_text``.

        Two modes:
          - **single paragraph** (``end_para is None``): ``length`` chars
            are deleted at ``(para, char_offset)``, then ``new_text`` is
            inserted at the same spot.
          - **cross paragraph** (``end_para`` set): split into per-paragraph
            ``deleteText`` operations so each paragraph keeps its own
            ``<hp:p>`` element + ``paraPrIDRef`` — this preserves heading /
            body styling across the boundary and makes the edit fully
            reversible by ``undo_edit``. rhwp's ``deleteRange`` is NOT
            used because it collapses paragraphs and loses styles.

        The per-paragraph split looks like:
          1. Snapshot start-paragraph tail, end-paragraph head, and the
             full text of every paragraph strictly between them.
          2. ``deleteText`` the start-paragraph tail (``[start_off, end_of_para)``).
          3. ``deleteText`` the end-paragraph head (``[0, end_off)``).
          4. For each middle paragraph, delete its entire content (leaves
             an empty paragraph stump — structurally preserved).
          5. ``insertText`` ``new_text`` at ``(para, char_offset)``.

        ``undo_edit`` reverses each of those five steps precisely.
        """
        is_range = end_para is not None
        entry: dict[str, Any]
        if is_range:
            end_para_i = int(end_para)
            end_off_i = int(end_char_offset or 0)

            # --- Step 1: snapshot every affected segment for undo replay ---
            start_para_len = self.get_paragraph_length(sec, para, cell=cell)
            start_tail = (
                self.get_text_range(sec, para, char_offset, start_para_len - char_offset, cell=cell)
                if start_para_len > char_offset else ""
            )
            end_head = (
                self.get_text_range(sec, end_para_i, 0, end_off_i, cell=cell)
                if end_off_i > 0 else ""
            )
            middles: list[dict[str, Any]] = []
            for p in range(para + 1, end_para_i):
                plen = self.get_paragraph_length(sec, p, cell=cell)
                ptext = self.get_text_range(sec, p, 0, plen, cell=cell) if plen > 0 else ""
                middles.append({"para": p, "text": ptext, "length": plen})

            old_text = "\n".join(
                [start_tail] + [m["text"] for m in middles] + [end_head]
            )

            # --- Step 2 & 3: truncate the two boundary paragraphs ---
            if start_para_len > char_offset:
                self.delete_text(sec, para, char_offset, start_para_len - char_offset, cell=cell)
            if end_off_i > 0:
                self.delete_text(sec, end_para_i, 0, end_off_i, cell=cell)

            # --- Step 4: empty every middle paragraph ---
            for m in middles:
                if m["length"] > 0:
                    self.delete_text(sec, m["para"], 0, m["length"], cell=cell)

            # --- Step 5: insert the replacement at the start point ---
            if new_text:
                self.insert_text(sec, para, char_offset, new_text, cell=cell)

            edit_id = self._next_edit_id
            self._next_edit_id += 1
            entry = {
                "id": edit_id,
                "sec": sec,
                "para": para,
                "charOffset": char_offset,
                "oldText": old_text,
                "newText": new_text,
                "undone": False,
                "cell": cell,
                "endPara": end_para_i,
                "endCharOffset": end_off_i,
                # Snapshots needed to reverse the per-paragraph delete chain.
                "_startTail": start_tail,
                "_endHead": end_head,
                "_middles": middles,
            }
        else:
            old_text = (
                self.get_text_range(sec, para, char_offset, length, cell=cell)
                if length > 0 else ""
            )
            if length > 0:
                self.delete_text(sec, para, char_offset, length, cell=cell)
            if new_text:
                self.insert_text(sec, para, char_offset, new_text, cell=cell)
            edit_id = self._next_edit_id
            self._next_edit_id += 1
            entry = {
                "id": edit_id,
                "sec": sec,
                "para": para,
                "charOffset": char_offset,
                "oldText": old_text,
                "newText": new_text,
                "undone": False,
                "cell": cell,
            }

        self.edits.append(entry)
        self.version += 1
        return entry

    def undo_edit(self, edit_id: int) -> dict[str, Any]:
        """Toggle an edit's ``undone`` flag and replay the inverse mutation.

        Single-paragraph: delete ``newText`` span, insert ``oldText``.
        Cross-paragraph: fully reversible because apply preserved paragraph
        structure — we restore each snapshotted segment:
          1. Remove ``newText`` from the start paragraph.
          2. Re-insert the start paragraph's original tail.
          3. Re-insert each middle paragraph's text.
          4. Re-insert the end paragraph's original head.
        """
        entry = next((e for e in self.edits if e["id"] == edit_id), None)
        if entry is None:
            raise KeyError(f"edit {edit_id} not found")

        sec, para, off = entry["sec"], entry["para"], entry["charOffset"]
        cell = entry.get("cell")
        is_range = "endPara" in entry
        currently_undone = entry["undone"]

        if is_range:
            if not currently_undone:
                # Apply → undone: reverse all five apply steps.
                new_text = entry["newText"]
                if new_text:
                    self.delete_text(sec, para, off, len(new_text), cell=cell)
                start_tail = entry.get("_startTail", "")
                if start_tail:
                    self.insert_text(sec, para, off, start_tail, cell=cell)
                for m in entry.get("_middles", []):
                    if m["text"]:
                        self.insert_text(sec, m["para"], 0, m["text"], cell=cell)
                end_head = entry.get("_endHead", "")
                if end_head:
                    self.insert_text(sec, entry["endPara"], 0, end_head, cell=cell)
            else:
                # Undone → redo: replay the original five apply steps.
                # Delete the tail the undo reinserted, then the middles, then the head.
                start_tail = entry.get("_startTail", "")
                if start_tail:
                    self.delete_text(sec, para, off, len(start_tail), cell=cell)
                for m in entry.get("_middles", []):
                    if m["text"]:
                        self.delete_text(sec, m["para"], 0, len(m["text"]), cell=cell)
                end_head = entry.get("_endHead", "")
                if end_head:
                    self.delete_text(sec, entry["endPara"], 0, len(end_head), cell=cell)
                new_text = entry["newText"]
                if new_text:
                    self.insert_text(sec, para, off, new_text, cell=cell)
        else:
            currently_new = entry["newText"] if not currently_undone else entry["oldText"]
            target_text = entry["oldText"] if not currently_undone else entry["newText"]
            if currently_new:
                self.delete_text(sec, para, off, len(currently_new), cell=cell)
            if target_text:
                self.insert_text(sec, para, off, target_text, cell=cell)

        entry["undone"] = not currently_undone
        self.version += 1
        return entry

    # ----- persistence ---------------------------------------------------

    def export_hwp_bytes(self) -> bytes:
        """Serialize the current document state to HWP bytes.

        rhwp exposes only ``exportHwp`` (HWP 5.x binary) — it does **not**
        serialize back to HWPX. HWPX round-trip requires a separate path: keep
        the original HWPX in-memory and replay edits via pyhwpxlib's
        ``json_io.patch``. That is planned for M4R — see Design v0.3 §5.3.
        """
        if "hwpdocument_exportHwp" not in self._exports:
            raise RuntimeError("rhwp WASM missing hwpdocument_exportHwp")
        with self._engine._lock:
            ret = self._exports["hwpdocument_exportHwp"](self._store, self._handle)
        return _consume_bytes(self, ret)

    # ----- lifecycle -----------------------------------------------------

    def close(self) -> None:
        if self._closed:
            return
        try:
            with self._engine._lock:
                self._doc.close()
        finally:
            self._closed = True

    # ----- internals -----------------------------------------------------

    def _call_json(self, export_name: str, *args: Any) -> Any:
        """Call a WASM export that returns ``Result<String, JsValue>`` and parse.

        Expected return layout (wasm_bindgen default): ``(ptr, len, err_ptr, is_err)``.
        """
        if export_name not in self._exports:
            raise RuntimeError(f"rhwp WASM export missing: {export_name}")
        with self._engine._lock:
            ret = self._exports[export_name](self._store, *args)
        return _decode_result_string(self, ret)

    def _call_json_with_string(
        self,
        export_name: str,
        text: str,
        *args: Any,
    ) -> Any:
        """Call an export that takes a ``&str`` parameter (alloc + (ptr, len)).

        The string is allocated in WASM memory, the export is called with the
        non-string args followed by ``(ptr, len)`` for the string argument, and
        the return is decoded as a JSON result string.
        """
        if export_name not in self._exports:
            raise RuntimeError(f"rhwp WASM export missing: {export_name}")
        encoded = text.encode("utf-8")
        with self._engine._lock:
            ptr = self._exports["__wbindgen_malloc"](self._store, len(encoded), 1)
            base = self._memory.data_ptr(self._store)
            addr = ctypes.addressof(base.contents) + ptr
            ctypes.memmove(addr, encoded, len(encoded))
            ret = self._exports[export_name](self._store, *args, ptr, len(encoded))
        return _decode_result_string(self, ret)


# ---------------------------------------------------------------------------
# Low-level helpers (normalize rhwp's wire format)
# ---------------------------------------------------------------------------


def _decode_result_string(session: DocumentSession, ret: Any) -> Any:
    """Decode a ``Result<String, JsValue>`` wasm_bindgen return."""
    # Empty / scalar return
    if ret is None or isinstance(ret, (int, float, bool)):
        return ret
    if isinstance(ret, str):
        return _parse_json_maybe(ret)
    # Expect a tuple. The exact arity differs per export; we support the two
    # most common: (ptr, len, err_ptr, is_err) and (ptr, len).
    if isinstance(ret, (tuple, list)) and len(ret) >= 2:
        ptr, length = int(ret[0]), int(ret[1])
        is_err = int(ret[3]) if len(ret) >= 4 else 0
        text = _read_utf8(session, ptr, length)
        try:
            session._exports["__wbindgen_free"](session._store, ptr, length, 1)
        except Exception:
            pass
        if is_err:
            raise RuntimeError(f"rhwp WASM error: {text[:500]}")
        return _parse_json_maybe(text)
    return ret


def _read_utf8(session: DocumentSession, ptr: int, length: int) -> str:
    if ptr == 0 or length == 0:
        return ""
    base = session._memory.data_ptr(session._store)
    addr = ctypes.addressof(base.contents) + ptr
    return bytes((ctypes.c_ubyte * length).from_address(addr)).decode("utf-8", "replace")


def _parse_json_maybe(text: str) -> Any:
    s = text.strip()
    if not s:
        return None
    if s[0] in "{[":
        try:
            return json.loads(s)
        except json.JSONDecodeError:
            return s
    return s


def _normalize_location(d: dict[str, Any]) -> dict[str, Any]:
    """rhwp key variants → {sec, para, charOffset, cell?}.

    When the hit lands inside a table cell, rhwp's ``hitTest`` returns
    additional fields ``parentParaIndex``, ``controlIndex``, ``cellIndex``,
    ``cellParaIndex``. We collapse those into a nested ``cell`` block and
    use ``cellParaIndex`` as the ``para`` field so downstream code treats
    ``(sec, para, charOffset)`` uniformly — ``cell`` presence then tells
    it which rhwp exports to call.
    """
    sec = d.get("sec")
    if sec is None:
        sec = d.get("sectionIndex", d.get("section", 0))
    off = d.get("charOffset")
    if off is None:
        off = d.get("offset", d.get("charPos", 0))

    # Cell-local hit? rhwp only emits these fields when the hit is in a cell.
    if "cellIndex" in d or "cellParaIndex" in d:
        cell = {
            "parentParaIndex": int(d.get("parentParaIndex", 0)),
            "controlIndex": int(d.get("controlIndex", 0)),
            "cellIndex": int(d.get("cellIndex", 0)),
        }
        # Inside-cell hit: prefer cellParaIndex as ``para`` so the caller can
        # stay in the flat (sec, para, off) vocabulary.
        para = int(d.get("cellParaIndex", 0))
        return {"sec": int(sec), "para": para, "charOffset": int(off), "cell": cell}

    para = d.get("para")
    if para is None:
        para = d.get("paraIndex", d.get("paragraphIndex", 0))
    return {"sec": int(sec), "para": int(para), "charOffset": int(off)}


def _normalize_rect(d: dict[str, Any]) -> dict[str, float]:
    return {
        "page": int(d.get("page", d.get("pageIndex", 0))),
        "x": float(d.get("x", 0.0)),
        "y": float(d.get("y", 0.0)),
        "width": float(d.get("width", d.get("w", 0.0))),
        "height": float(d.get("height", d.get("h", 0.0))),
    }


def _line_spacing(rects: list[dict[str, float]]) -> float:
    """Estimate per-line vertical spacing from a list of rects.

    Returns the smallest positive y-delta between consecutive rects in
    document order, or 0.0 if no clean signal is available. Used by the
    cursor-rect augmentation pass to decide whether a probe's y matches
    an existing rect's line.
    """
    ys = sorted({float(r["y"]) for r in rects})
    deltas: list[float] = []
    for a, b in zip(ys, ys[1:]):
        d = b - a
        if d > 0.5:
            deltas.append(d)
    return min(deltas) if deltas else 0.0


# NOTE: A previous "repair leading duplicate" approach was removed on
# 2026-04-25; it placed boxes in the wrong area when the actual missing
# line was after the last reported rect. The current strategy is to dedup
# rhwp's output and then probe rhwp's cursor-rect API at the boundaries
# to recover any line that ``getSelectionRects`` failed to emit.


def _consume_bytes(session: DocumentSession, ret: Any) -> bytes:
    """Turn a WASM return of shape (ptr, len[, err_ptr, is_err]) into bytes."""
    if isinstance(ret, bytes):
        return ret
    if isinstance(ret, (tuple, list)) and len(ret) >= 2:
        ptr, length = int(ret[0]), int(ret[1])
        is_err = int(ret[3]) if len(ret) >= 4 else 0
        base = session._memory.data_ptr(session._store)
        addr = ctypes.addressof(base.contents) + ptr
        data = bytes((ctypes.c_ubyte * length).from_address(addr))
        try:
            session._exports["__wbindgen_free"](session._store, ptr, length, 1)
        except Exception:
            pass
        if is_err:
            raise RuntimeError(f"rhwp WASM returned error: {data[:200]!r}")
        return data
    raise RuntimeError(f"Unexpected rhwp return type: {type(ret).__name__}")


def resolve_wasm_path() -> Optional[Path]:
    """Return the resolved rhwp_bg.wasm path if pyhwpxlib[preview] is installed."""
    try:
        from pyhwpxlib.rhwp_bridge import _find_wasm

        return _find_wasm()
    except Exception:
        return None
