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
        with self._lock:
            doc = self._inner.load_bytes(data, name=name)
        return DocumentSession(self, doc, name=name)


# ---------------------------------------------------------------------------
# DocumentSession — per-upload state
# ---------------------------------------------------------------------------


class DocumentSession:
    """One loaded HWPX. Operations are serialized via the shared engine lock."""

    def __init__(self, engine: _BackedEngine, doc: Any, *, name: str) -> None:
        self._engine = engine
        self._doc = doc           # pyhwpxlib.rhwp_bridge.RhwpDocument
        self._exports = doc._engine._exports
        self._store = doc._engine._store
        self._memory = doc._engine._memory
        self._handle = doc._handle
        self.name = name
        self.version = 0
        self._closed = False

    # ----- pure-read API --------------------------------------------------

    @property
    def page_count(self) -> int:
        with self._engine._lock:
            return int(self._doc.page_count)

    def render_page_svg(self, page: int, *, embed_fonts: bool = False) -> str:
        """Render one page to SVG. Thread-safe via engine lock.

        ``embed_fonts=False`` keeps the SVG small and defers font resolution to
        the browser's own fallback chain (the CSS ``font-family`` list rhwp
        emits already covers Korean defaults for macOS/Windows). Flip to
        ``True`` for fully self-contained SVGs at the cost of ~hundreds of KB.
        """
        with self._engine._lock:
            return self._doc.render_page_svg(page, embed_fonts=embed_fonts)

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
    ) -> str:
        """Return the substring at (sec, para, charOffset) of length count."""
        result = self._call_json(
            "hwpdocument_getTextRange", self._handle, sec, para, char_offset, count,
        )
        if isinstance(result, dict):
            return str(result.get("text", ""))
        return str(result or "")

    def get_selection_rects(
        self,
        sec: int,
        start_para: int,
        start_char_offset: int,
        end_para: int,
        end_char_offset: int,
    ) -> list[dict[str, float]]:
        """Return pixel rectangles covering a selection. One rect per visual line."""
        result = self._call_json(
            "hwpdocument_getSelectionRects",
            self._handle, sec, start_para, start_char_offset, end_para, end_char_offset,
        )
        if isinstance(result, list):
            return [_normalize_rect(r) for r in result]
        return []

    def insert_text(self, sec: int, para: int, char_offset: int, text: str) -> dict[str, Any]:
        """Insert ``text`` at (sec, para, charOffset). Returns rhwp ack JSON."""
        return self._call_json_with_string(
            "hwpdocument_insertText", text, self._handle, sec, para, char_offset,
        ) or {}

    def delete_text(self, sec: int, para: int, char_offset: int, count: int) -> dict[str, Any]:
        """Delete ``count`` chars starting at (sec, para, charOffset)."""
        return self._call_json(
            "hwpdocument_deleteText", self._handle, sec, para, char_offset, count,
        ) or {}

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
    if isinstance(ret, tuple) and len(ret) >= 2:
        ptr, length = ret[0], ret[1]
        is_err = ret[3] if len(ret) >= 4 else 0
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


def _normalize_location(d: dict[str, Any]) -> dict[str, int]:
    """rhwp key variants → {sec, para, charOffset}."""
    sec = d.get("sec")
    if sec is None:
        sec = d.get("sectionIndex", d.get("section", 0))
    para = d.get("para")
    if para is None:
        para = d.get("paraIndex", d.get("paragraphIndex", 0))
    off = d.get("charOffset")
    if off is None:
        off = d.get("offset", d.get("charPos", 0))
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
