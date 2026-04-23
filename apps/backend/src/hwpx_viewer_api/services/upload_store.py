"""In-memory LRU upload session store (Design §4.2).

Keyed by a UUID ``uploadId`` issued on /api/import. Entry payload bundles the
path to the temp-saved source .hwpx plus the overlay and doc snapshots so
/api/export can apply edits without re-parsing the original file.

Limitations (explicitly accepted for v1.0):
- Process-local: does not survive restarts, cannot be shared between
  multiple backend replicas. v1.5+ will swap for Redis (see Design §14).
- Best-effort TTL: expired entries are cleaned on the next access, not via
  a background task.
"""

from __future__ import annotations

import os
import threading
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any


@dataclass
class UploadEntry:
    upload_id: str
    hwpx_path: str
    overlays: list[dict[str, Any]]  # index == section_idx
    doc: dict[str, Any]
    file_name: str
    file_size: int
    created_at: float = field(default_factory=time.time)


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
        hwpx_path: str,
        overlays: list[dict[str, Any]],
        doc: dict[str, Any],
        file_name: str,
        file_size: int,
    ) -> str:
        upload_id = str(uuid.uuid4())
        entry = UploadEntry(
            upload_id=upload_id,
            hwpx_path=hwpx_path,
            overlays=overlays,
            doc=doc,
            file_name=file_name,
            file_size=file_size,
        )
        with self._lock:
            self._entries[upload_id] = entry
            self._evict_locked()
        return upload_id

    def get(self, upload_id: str) -> UploadEntry | None:
        now = time.time()
        with self._lock:
            entry = self._entries.get(upload_id)
            if entry is None:
                return None
            if now - entry.created_at > self._ttl:
                self._entries.pop(upload_id, None)
                _safe_remove(entry.hwpx_path)
                return None
            # Refresh LRU position.
            self._entries.move_to_end(upload_id)
            return entry

    def delete(self, upload_id: str) -> None:
        with self._lock:
            entry = self._entries.pop(upload_id, None)
        if entry is not None:
            _safe_remove(entry.hwpx_path)

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)

    def clear(self) -> None:
        with self._lock:
            entries = list(self._entries.values())
            self._entries.clear()
        for entry in entries:
            _safe_remove(entry.hwpx_path)

    # ---- internals ----

    def _evict_locked(self) -> None:
        # Evict expired first.
        now = time.time()
        expired: list[str] = [
            uid for uid, e in self._entries.items() if now - e.created_at > self._ttl
        ]
        for uid in expired:
            e = self._entries.pop(uid)
            _safe_remove(e.hwpx_path)

        # Then evict oldest until under capacity.
        while len(self._entries) > self._capacity:
            _uid, e = self._entries.popitem(last=False)
            _safe_remove(e.hwpx_path)


def _safe_remove(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        # File might have been cleaned up externally or never existed.
        pass


# Module-level singleton. Created once per process; tests clear via .clear().
_singleton = UploadStore()


def get_upload_store() -> UploadStore:
    return _singleton
