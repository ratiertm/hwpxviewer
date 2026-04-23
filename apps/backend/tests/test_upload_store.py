"""Upload LRU + TTL store tests."""

from __future__ import annotations

import os
import tempfile
import time

from hwpx_viewer_api.services.upload_store import UploadStore


def _touch(path: str) -> None:
    with open(path, "wb") as f:
        f.write(b"\x00")


def test_put_and_get_round_trip(tmp_path) -> None:
    store = UploadStore(capacity=5, ttl_seconds=60)
    p = tmp_path / "a.hwpx"
    _touch(str(p))
    uid = store.put(
        hwpx_path=str(p), overlays=[{"x": 1}], doc={"y": 2}, file_name="a.hwpx", file_size=1
    )
    entry = store.get(uid)
    assert entry is not None
    assert entry.overlays == [{"x": 1}]
    assert entry.file_name == "a.hwpx"


def test_ttl_expires_entry_and_removes_file(tmp_path) -> None:
    store = UploadStore(capacity=5, ttl_seconds=0)  # everything expires immediately
    p = tmp_path / "a.hwpx"
    _touch(str(p))
    uid = store.put(
        hwpx_path=str(p), overlays=[], doc={}, file_name="a.hwpx", file_size=1
    )
    time.sleep(0.01)
    assert store.get(uid) is None
    assert not p.exists()


def test_capacity_evicts_oldest(tmp_path) -> None:
    store = UploadStore(capacity=2, ttl_seconds=60)
    ids: list[str] = []
    files: list[str] = []
    for i in range(3):
        p = tmp_path / f"{i}.hwpx"
        _touch(str(p))
        files.append(str(p))
        ids.append(
            store.put(
                hwpx_path=str(p),
                overlays=[],
                doc={},
                file_name=f"{i}.hwpx",
                file_size=1,
            )
        )
    # First entry should be evicted; later two survive.
    assert store.get(ids[0]) is None
    assert not os.path.exists(files[0])
    assert store.get(ids[1]) is not None
    assert store.get(ids[2]) is not None


def test_delete_removes_entry_and_file(tmp_path) -> None:
    store = UploadStore()
    p = tmp_path / "x.hwpx"
    _touch(str(p))
    uid = store.put(
        hwpx_path=str(p), overlays=[], doc={}, file_name="x.hwpx", file_size=1
    )
    store.delete(uid)
    assert store.get(uid) is None
    assert not p.exists()
