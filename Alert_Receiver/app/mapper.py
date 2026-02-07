"""Pattern matching and field mapping - map incoming JSON to standardized alarm fields."""
import re
from typing import Any, Dict, List, Optional, Tuple

from app.config import ApiPattern, get_pattern_for_source


_PATH_SEGMENT = re.compile(r"([^\[\]]+)(?:\[(\d+)\])?")


def _parse_path(path: str) -> List[Tuple[str, Optional[int]]]:
    segments = []
    for part in path.split("."):
        match = _PATH_SEGMENT.fullmatch(part.strip())
        if not match:
            segments.append((part, None))
        else:
            key = match.group(1)
            idx = match.group(2)
            segments.append((key, int(idx) if idx is not None else None))
    return segments


def _get_by_path(data: Any, path: str) -> Tuple[bool, Any]:
    current = data
    for key, idx in _parse_path(path):
        if isinstance(current, dict) and key in current:
            current = current[key]
        else:
            return False, None
        if idx is not None:
            if isinstance(current, list) and 0 <= idx < len(current):
                current = current[idx]
            else:
                return False, None
    return True, current


def map_payload_to_fields(payload: Any, source_id: str) -> Dict[str, Any]:
    """
    Apply pattern mapping to incoming payload. Returns flat dict of mapped fields.
    Supports route aliases: ocp-alertmanager -> uses OCP pattern.
    """
    pattern, _ = get_pattern_for_source(source_id)
    result: Dict[str, Any] = {}

    if pattern:
        for m in pattern.mappings:
            found, value = _get_by_path(payload, m.source_path)
            if found:
                result[m.target_field] = value  # รวม null/empty ด้วย เพื่อให้ column แสดงครบ
        if pattern.enrich:
            for k, v in pattern.enrich.items():
                result.setdefault(k, v)
    else:
        # Fallback: extract common fields if no pattern
        if isinstance(payload, dict):
            for key in ("severity", "message", "title", "status", "alertname", "description"):
                if key in payload:
                    result[key] = payload[key]
            if "labels" in payload and isinstance(payload["labels"], dict):
                result.setdefault("severity", payload["labels"].get("severity"))
                result.setdefault("alertname", payload["labels"].get("alertname"))
            if "annotations" in payload and isinstance(payload["annotations"], dict):
                result.setdefault("message", payload["annotations"].get("summary") or payload["annotations"].get("description"))

    return result
