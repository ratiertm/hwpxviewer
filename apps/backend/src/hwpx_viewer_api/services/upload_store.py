"""In-memory LRU upload session store (Design v0.3 §4.2).

Keyed by a UUID ``uploadId`` issued on ``/api/upload``. Entry payload bundles
the document metadata and the live rhwp ``DocumentSession`` so every
``/api/render``, ``/api/hit-test``, ``/api/edit`` call can reuse the same
WASM-loaded document without re-parsing.

Limitations (explicitly accepted for v1.0):
- Process-local: does not survive restarts, cannot be shared between
  multiple backend replicas. v1.5+ will swap for Redis (see Design §14).
- Best-effort TTL: expired entries are cleaned on the next access, not via
  a background task.
"""

from __future__ import annotations

import threading
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:  # avoid eager import of rhwp_wasm (wasmtime heavy)
    from .rhwp_wasm import DocumentSession


@dataclass
class UploadEntry:
    upload_id: str
    file_name: str
    file_size: int
    session: "DocumentSession"
    created_at: float = field(default_factory=time.time)
    version: int = 0  # increments on every successful edit


class UploadStore:
    def __init__(self, *, capacity: int = 100, ttl_seconds: int = 30 * 60) -> None:
        self._capacity = capacity
        self._ttl = ttl_seconds
        self._entries: OrderedDict[str, UploadEntry] = OrderedDict()
        self._lock = threading.Lock()

    # ---- public API ----

    def put(
        self,
        *,
        session: "DocumentSession",
        file_name: str,
        file_size: int,
    ) -> str:
        upload_id = str(uuid.uuid4())
        entry = UploadEntry(
            upload_id=upload_id,
            file_name=file_name,
            file_size=file_size,
            session=session,
        )
        with self._lock:
            self._entries[upload_id] = entry
            self._evict_locked()
        return upload_id

    def get(self, upload_id: str) -> Optional[UploadEntry]:
        now = time.time()
        with self._lock:
            entry = self._entries.get(upload_id)
            if entry is None:
                return None
            if now - entry.created_at > self._ttl:
                self._entries.pop(upload_id, None)
                _safe_close(entry.session)
                return None
            self._entries.move_to_end(upload_id)
            return entry

    def delete(self, upload_id: str) -> None:
        with self._lock:
            entry = self._entries.pop(upload_id, None)
        if entry is not None:
            _safe_close(entry.session)

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)

    def clear(self) -> None:
        with self._lock:
            entries = list(self._entries.values())
            self._entries.clear()
        for entry in entries:
            _safe_close(entry.session)

    # ---- internals ----

    def _evict_locked(self) -> None:
        now = time.time()
        expired = [uid for uid, e in self._entries.items() if now - e.created_at > self._ttl]
        for uid in expired:
            e = self._entries.pop(uid)
            _safe_close(e.session)
        while len(self._entries) > self._capacity:
            _uid, e = self._entries.popitem(last=False)
            _safe_close(e.session)


def _safe_close(session: Optional["DocumentSession"]) -> None:
    if session is None:
        return
    try:
        session.close()
    except Exception:  # noqa: BLE001 — cleanup must not raise
        pass


# Module-level singleton. Created once per process; tests clear via .clear().
_singleton = UploadStore()


def get_upload_store() -> UploadStore:
    return _singleton
