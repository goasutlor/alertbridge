"""Optional on-disk dead-letter queue: one JSON object per failed forward."""
import json
import logging
import os
import threading
import uuid
from typing import Any, Dict, List, Optional, Set, Tuple

_lock = threading.Lock()
_logger = logging.getLogger("alertbridge")


def dlq_file_path() -> str:
    return os.getenv("ALERTBRIDGE_DLQ_FILE", "").strip()


def read_recent_dlq(limit: int = 50, max_read_bytes: int = 2_000_000) -> List[Dict[str, Any]]:
    """
    Return up to `limit` newest JSONL rows (newest first). Reads only the tail of the file for speed.
    """
    path = dlq_file_path()
    if not path or not os.path.isfile(path):
        return []
    limit = max(1, min(int(limit), 500))
    try:
        size = os.path.getsize(path)
    except OSError:
        return []
    read_size = min(size, max_read_bytes)
    try:
        with _lock:
            with open(path, "rb") as handle:
                if read_size < size:
                    handle.seek(-read_size, os.SEEK_END)
                else:
                    handle.seek(0)
                chunk = handle.read()
    except OSError as exc:
        _logger.warning("dlq_read_failed path=%s: %s", path, exc)
        return []
    lines = chunk.split(b"\n")
    if read_size < size and lines:
        lines = lines[1:]
    out: List[Dict[str, Any]] = []
    for raw in reversed(lines):
        if len(out) >= limit:
            break
        line = raw.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line.decode("utf-8")))
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
    return out


def record_failed_forward(record: Dict[str, Any]) -> None:
    """
    Append one JSON line if ALERTBRIDGE_DLQ_FILE is set (absolute path recommended).
    Mount a PVC or hostPath on that path for durability across Pod restarts.

    One line per completed forward attempt that failed after internal retries (not per retry hop).
    If the route uses alert unrolling, one webhook may produce multiple lines (unroll_index /
    unroll_count); that is not duplicate retries.
    """
    path = dlq_file_path()
    if not path:
        return
    if not record.get("dlq_id"):
        record["dlq_id"] = str(uuid.uuid4())
    line = json.dumps(record, ensure_ascii=False, default=str) + "\n"
    try:
        parent = os.path.dirname(path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with _lock:
            with open(path, "a", encoding="utf-8") as handle:
                handle.write(line)
    except OSError as exc:
        _logger.warning("dlq_write_failed path=%s: %s", path, exc)


def purge_dlq_all() -> Tuple[bool, Optional[str]]:
    """Truncate the DLQ file. Returns (ok, error_message)."""
    path = dlq_file_path()
    if not path:
        return False, "ALERTBRIDGE_DLQ_FILE not set"
    try:
        parent = os.path.dirname(path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with _lock:
            with open(path, "w", encoding="utf-8"):
                pass
        return True, None
    except OSError as exc:
        return False, str(exc)


def purge_dlq_by_ids(ids: Set[str]) -> Tuple[int, Optional[str]]:
    """
    Remove JSONL lines whose parsed object has dlq_id in ids.
    Returns (removed_count, error_message).
    """
    path = dlq_file_path()
    if not path:
        return 0, "ALERTBRIDGE_DLQ_FILE not set"
    if not ids:
        return 0, None
    if not os.path.isfile(path):
        return 0, None
    tmp_path = path + ".tmp"
    removed = 0
    try:
        with _lock:
            with open(path, "r", encoding="utf-8") as inf, open(tmp_path, "w", encoding="utf-8") as outf:
                for line in inf:
                    raw = line.strip()
                    if not raw:
                        continue
                    try:
                        obj = json.loads(raw)
                    except json.JSONDecodeError:
                        outf.write(line)
                        continue
                    did = obj.get("dlq_id")
                    if did and did in ids:
                        removed += 1
                    else:
                        outf.write(line if line.endswith("\n") else line + "\n")
            os.replace(tmp_path, path)
        return removed, None
    except OSError as exc:
        try:
            if os.path.isfile(tmp_path):
                os.unlink(tmp_path)
        except OSError:
            pass
        return 0, str(exc)
