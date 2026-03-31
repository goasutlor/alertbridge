"""Optional on-disk dead-letter queue: one JSON object per failed forward."""
import json
import logging
import os
import threading
from typing import Any, Dict

_lock = threading.Lock()
_logger = logging.getLogger("alertbridge")


def dlq_file_path() -> str:
    return os.getenv("ALERTBRIDGE_DLQ_FILE", "").strip()


def record_failed_forward(record: Dict[str, Any]) -> None:
    """
    Append one JSON line if ALERTBRIDGE_DLQ_FILE is set (absolute path recommended).
    Mount a PVC or hostPath on that path for durability across Pod restarts.
    """
    path = dlq_file_path()
    if not path:
        return
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
