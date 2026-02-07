"""Auto-generate pattern mappings from sample JSON payload; generate expected JSON from pattern."""
import json
import re
from typing import Any, Dict, List, Optional, Tuple

_PATH_SEGMENT = re.compile(r"([^\[\]]+)(?:\[(\d+)\])?")


# ---- Auto Gen (sample JSON -> mappings) ----

def _flatten_obj(obj: Any, prefix: str = "") -> List[Tuple[str, Any]]:
    out: List[Tuple[str, Any]] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            path = f"{prefix}.{k}" if prefix else k
            if isinstance(v, (dict, list)) and v is not None:
                out.extend(_flatten_obj(v, path))
            else:
                out.append((path, v))
    elif isinstance(obj, list) and obj:
        for i, item in enumerate(obj[:3]):
            path = f"{prefix}[{i}]"
            if isinstance(item, (dict, list)):
                out.extend(_flatten_obj(item, path))
            else:
                out.append((path, item))
    return out


_PATH_TO_TARGET: Dict[str, str] = {
    "severity": "severity", "labels.severity": "severity", "labels.alertname": "alertname",
    "labels.instance": "instance", "labels.namespace": "namespace", "labels.pod": "pod",
    "labels.job": "job", "annotations.summary": "message", "annotations.description": "description",
    "description": "message", "summary": "message", "message": "message", "title": "title",
    "status": "status", "alertname": "alertname", "startsAt": "timestamp", "endsAt": "ends_at",
    "timestamp": "timestamp", "alertId": "alert_id", "clusterId": "cluster_id",
    "generatorURL": "generator_url",
}


def _suggest_target(path: str) -> str:
    for suffix, target in _PATH_TO_TARGET.items():
        if path == suffix or path.endswith("." + suffix):
            return target
    parts = path.replace("[", ".").replace("]", "").split(".")
    last = parts[-1] if parts else path
    return last.replace("-", "_").lower()


def auto_gen_mappings(sample: Any) -> List[Dict[str, str]]:
    pairs = _flatten_obj(sample) if isinstance(sample, dict) else []
    seen_targets: Dict[str, str] = {}
    mappings: List[Dict[str, str]] = []
    for path, val in pairs:
        if val is None or (isinstance(val, str) and not val.strip()):
            continue
        target = _suggest_target(path)
        if target in seen_targets and seen_targets[target] != path:
            continue
        seen_targets[target] = path
        mappings.append({"source_path": path, "target_field": target})
    return mappings


# ---- Gen Expected JSON (mappings -> sample for AlertBridge) ----


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


def _set_by_path(root: Dict[str, Any], path: str, value: Any) -> None:
    """Set value at path in nested dict. Creates intermediate dicts/lists."""
    segments = _parse_path(path)
    current: Any = root
    for i, (key, idx) in enumerate(segments):
        is_last = i == len(segments) - 1
        if idx is None:
            if is_last:
                current[key] = value
                return
            if key not in current or not isinstance(current.get(key), dict):
                current[key] = {}
            current = current[key]
        else:
            if key not in current or not isinstance(current.get(key), list):
                current[key] = []
            arr = current[key]
            while len(arr) <= idx:
                arr.append({} if not is_last and i < len(segments) - 1 else value)
            if is_last:
                arr[idx] = value
                return
            current = arr[idx]
    return


def gen_expected_json(mappings: List[Dict[str, str]], use_example_values: bool = True) -> str:
    """
    Generate sample JSON from pattern mappings - the structure AlertBridge/sender should send.
    Returns formatted JSON string.
    """
    root: Dict[str, Any] = {}
    example_vals: Dict[str, str] = {
        "status": "firing",
        "severity": "critical",
        "alertname": "TargetDown",
        "message": "Target is down",
        "description": "Description of the alert",
        "instance": "localhost:9090",
        "namespace": "openshift-monitoring",
        "pod": "prometheus-k8s-0",
        "timestamp": "2026-02-06T15:00:00Z",
        "generator_url": "http://prometheus:9090/...",
        "alert_id": "alert-123",
        "cluster_id": "cluster-1",
        "title": "Alert Title",
    }
    for m in mappings or []:
        src = m.get("source_path", "")
        tgt = m.get("target_field", "")
        if not src:
            continue
        val = example_vals.get(tgt, "<" + tgt + ">") if use_example_values else "<value>"
        _set_by_path(root, src, val)
    return json.dumps(root, indent=2, ensure_ascii=False)
