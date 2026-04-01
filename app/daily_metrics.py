"""Persisted daily counters stored alongside DLQ on PVC."""
import json
import logging
import os
import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from app.dlq import dlq_file_path

_lock = threading.Lock()
_logger = logging.getLogger("alertbridge")
BANGKOK = timezone(timedelta(hours=7))


def daily_metrics_file_path() -> str:
    """
    Metrics file path on persistent storage.
    Priority:
    1) ALERTBRIDGE_DAILY_METRICS_FILE
    2) <dirname(ALERTBRIDGE_DLQ_FILE)>/metrics/daily.json
    """
    explicit = os.getenv("ALERTBRIDGE_DAILY_METRICS_FILE", "").strip()
    if explicit:
        return explicit
    dlq = dlq_file_path()
    if not dlq:
        return ""
    base = os.path.dirname(dlq) or "."
    return os.path.join(base, "metrics", "daily.json")


def _load_all(path: str) -> Dict[str, Dict[str, Any]]:
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle) or {}
            if isinstance(data, dict):
                return data
    except (OSError, json.JSONDecodeError):
        return {}
    return {}


def _save_all(path: str, data: Dict[str, Dict[str, Any]]) -> None:
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2, sort_keys=True)


def increment_daily(metric: str, amount: int = 1, when: Optional[datetime] = None) -> None:
    """
    Increment one daily counter. No-op when no persistent path is configured.
    metric: incoming | forward_success | forward_fail | dlq

    Semantics (main webhook handler):
    - incoming: one per POST webhook accepted
    - forward_success: one per successful outbound forward (may exceed incoming when unroll_alerts)
    - forward_fail: one per incoming webhook that had at least one failed forward
    - dlq: same as forward_fail (aligned with “event” side); DLQ file lines may be higher when unrolling
    If every webhook fails all outbounds that day, incoming = forward_fail = dlq for the day.
    If some webhooks have partial or full success, those totals differ — by design.
    """
    if metric not in {"incoming", "forward_success", "forward_fail", "dlq"}:
        return
    path = daily_metrics_file_path()
    if not path:
        return
    ts = when.astimezone(BANGKOK) if when else datetime.now(BANGKOK)
    day = ts.date().isoformat()
    try:
        with _lock:
            all_data = _load_all(path)
            row = all_data.get(day) or {
                "date": day,
                "incoming": 0,
                "forward_success": 0,
                "forward_fail": 0,
                "dlq": 0,
                "updated_at": ts.isoformat(timespec="seconds"),
            }
            row[metric] = int(row.get(metric, 0)) + int(amount)
            row["updated_at"] = ts.isoformat(timespec="seconds")
            all_data[day] = row
            _save_all(path, all_data)
    except OSError as exc:
        _logger.warning("daily_metrics_write_failed path=%s: %s", path, exc)


def read_daily(days: int = 30) -> List[Dict[str, Any]]:
    """Read newest N days of persisted counters (newest first)."""
    path = daily_metrics_file_path()
    if not path:
        return []
    lim = max(1, min(int(days), 3650))
    with _lock:
        all_data = _load_all(path)
    if not all_data:
        return []
    rows = [v for _, v in sorted(all_data.items(), key=lambda kv: kv[0], reverse=True)]
    return rows[:lim]
