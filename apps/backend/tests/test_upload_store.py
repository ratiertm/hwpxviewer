"""Upload LRU + TTL store tests (v0.3 — DocumentSession payload)."""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from hwpx_viewer_api.services.upload_store import UploadStore


@dataclass
class _FakeSession:
    """Stand-in for ``DocumentSession`` — records close() calls."""

    page_count: int = 1
    closed: bool = False

    def close(self) -> None:
        self.closed = True


def test_put_and_get_round_trip() -> None:
    store = UploadStore(capacity=5, ttl_seconds=60)
    session = _FakeSession(page_count=3)
    uid = store.put(session=session, file_name="a.hwpx", file_size=1024)
    entry = store.get(uid)
    assert entry is not None
    assert entry.file_name == "a.hwpx"
    assert entry.file_size == 1024
    assert entry.session is session


def test_ttl_expires_entry_and_closes_session() -> None:
    store = UploadStore(capacity=5, ttl_seconds=0)
    session = _FakeSession()
    uid = store.put(session=session, file_name="a.hwpx", file_size=1)
    time.sleep(0.01)
    assert store.get(uid) is None
    assert session.closed is True


def test_capacity_evicts_oldest_and_closes_session() -> None:
    store = UploadStore(capacity=2, ttl_seconds=60)
    sessions = [_FakeSession() for _ in range(3)]
    ids = [
        store.put(session=sessions[i], file_name=f"{i}.hwpx", file_size=1)
        for i in range(3)
    ]
    # First entry should be evicted and its session closed.
    assert store.get(ids[0]) is None
    assert sessions[0].closed is True
    # Later two survive.
    assert store.get(ids[1]) is not None
    assert store.get(ids[2]) is not None
    assert sessions[1].closed is False
    assert sessions[2].closed is False


def test_delete_removes_entry_and_closes_session() -> None:
    store = UploadStore()
    session = _FakeSession()
    uid = store.put(session=session, file_name="x.hwpx", file_size=1)
    store.delete(uid)
    assert store.get(uid) is None
    assert session.closed is True


def test_clear_closes_all_sessions() -> None:
    store = UploadStore()
    sessions = [_FakeSession() for _ in range(3)]
    for i, s in enumerate(sessions):
        store.put(session=s, file_name=f"{i}.hwpx", file_size=1)
    store.clear()
    assert len(store) == 0
    assert all(s.closed for s in sessions)
