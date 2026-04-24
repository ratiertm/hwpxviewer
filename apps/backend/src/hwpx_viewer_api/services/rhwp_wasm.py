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

        When ``cell`` is present, routes to
        ``hwpdocument_getSelectionRectsInCell`` — the cell-para indices are
        passed through ``start_para`` / ``end_para``.
        """
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
    ) -> dict[str, Any]:
        """Replace `length` chars at (sec, para, charOffset) with `new_text`.

        When ``cell`` is provided all three WASM calls (get_text_range,
        delete_text, insert_text) route to their ``*InCell`` variants so
        the edit lands inside a table cell.

        Captures ``oldText`` before the mutation so ``undo_edit`` can restore
        the original. Returns the recorded edit dict.
        """
        old_text = (
            self.get_text_range(sec, para, char_offset, length, cell=cell) if length > 0 else ""
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
            "cell": cell,   # preserve cell ref so undo can route identically
        }
        self.edits.append(entry)
        self.version += 1
        return entry

    def undo_edit(self, edit_id: int) -> dict[str, Any]:
        """Toggle an edit's ``undone`` flag and replay the inverse mutation."""
        entry = next((e for e in self.edits if e["id"] == edit_id), None)
        if entry is None:
            raise KeyError(f"edit {edit_id} not found")
        currently_new = entry["newText"] if not entry["undone"] else entry["oldText"]
        target_text = entry["oldText"] if not entry["undone"] else entry["newText"]
        sec, para, off = entry["sec"], entry["para"], entry["charOffset"]
        cell = entry.get("cell")
        if currently_new:
            self.delete_text(sec, para, off, len(currently_new), cell=cell)
        if target_text:
            self.insert_text(sec, para, off, target_text, cell=cell)
        entry["undone"] = not entry["undone"]
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
