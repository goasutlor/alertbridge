"""
Alert source patterns and field mapping for the Bridge.
Initial patterns: Red Hat OpenShift Alertmanager 4.20.10, Confluent Platform 8.10.
User can map source fields (left) to target fields (right), save as pattern, apply to route.
"""
import uuid
from typing import Any, Dict, List, Optional

from app.rules import (
    OutputTemplate,
    TransformConfig,
)


# Built-in source schemas: source_type_id -> { name, description, fields }
# Each field: { id: json_path, label: display_name }
# Paths must match actual payload structure for nested tiers to resolve.
SOURCE_SCHEMAS: Dict[str, Dict[str, Any]] = {
    "ocp-alertmanager-4.20": {
        "name": "Red Hat OpenShift Alertmanager 4.20.10",
        "description": "Alerts from OpenShift 4.20 Alertmanager (Prometheus/Alertmanager format)",
        "fields": [
            # Top-level
            {"id": "status", "label": "status"},
            {"id": "receiver", "label": "receiver"},
            # groupLabels (Tier 1)
            {"id": "groupLabels.alertname", "label": "groupLabels.alertname"},
            {"id": "groupLabels.job", "label": "groupLabels.job"},
            # commonLabels (Tier 1–2)
            {"id": "commonLabels.alertname", "label": "commonLabels.alertname"},
            {"id": "commonLabels.severity", "label": "commonLabels.severity"},
            {"id": "commonLabels.instance", "label": "commonLabels.instance"},
            {"id": "commonLabels.job", "label": "commonLabels.job"},
            {"id": "commonLabels.namespace", "label": "commonLabels.namespace"},
            {"id": "commonLabels.pod", "label": "commonLabels.pod"},
            # commonAnnotations (Tier 1–2)
            {"id": "commonAnnotations.summary", "label": "commonAnnotations.summary"},
            {"id": "commonAnnotations.description", "label": "commonAnnotations.description"},
            {"id": "commonAnnotations.runbook_url", "label": "commonAnnotations.runbook_url"},
            # alerts[0] (Tier 1–3+)
            {"id": "alerts.0.labels.alertname", "label": "alerts[0].labels.alertname"},
            {"id": "alerts.0.labels.severity", "label": "alerts[0].labels.severity"},
            {"id": "alerts.0.labels.instance", "label": "alerts[0].labels.instance"},
            {"id": "alerts.0.labels.job", "label": "alerts[0].labels.job"},
            {"id": "alerts.0.labels.namespace", "label": "alerts[0].labels.namespace"},
            {"id": "alerts.0.labels.pod", "label": "alerts[0].labels.pod"},
            {"id": "alerts.0.annotations.summary", "label": "alerts[0].annotations.summary"},
            {"id": "alerts.0.annotations.description", "label": "alerts[0].annotations.description"},
            {"id": "alerts.0.annotations.runbook_url", "label": "alerts[0].annotations.runbook_url"},
            {"id": "alerts.0.startsAt", "label": "alerts[0].startsAt"},
            {"id": "alerts.0.endsAt", "label": "alerts[0].endsAt"},
            {"id": "alerts.0.generatorURL", "label": "alerts[0].generatorURL"},
        ],
    },
    "confluent-8.10": {
        "name": "Confluent Platform 8.10",
        "description": "Alerts from Confluent Enterprise Platform 8.10",
        "fields": [
            {"id": "alertId", "label": "alertId"},
            {"id": "description", "label": "description"},
            {"id": "severity", "label": "severity"},
            {"id": "clusterId", "label": "clusterId"},
            {"id": "timestamp", "label": "timestamp"},
        ],
    },
}

# Standard target fields for forwarding (right column)
# Supports nested paths (e.g. labels.alertname) – output will preserve structure
TARGET_FIELDS: List[Dict[str, str]] = [
    # Prometheus/Alertmanager-style nested format
    {"id": "status", "label": "status"},
    {"id": "labels.alertname", "label": "labels.alertname"},
    {"id": "labels.severity", "label": "labels.severity"},
    {"id": "labels.namespace", "label": "labels.namespace"},
    {"id": "labels.pod", "label": "labels.pod"},
    {"id": "annotations.summary", "label": "annotations.summary"},
    {"id": "annotations.description", "label": "annotations.description"},
    {"id": "startsAt", "label": "startsAt"},
    {"id": "generatorURL", "label": "generatorURL"},
    # Flat format (alternative)
    {"id": "severity", "label": "Severity (flat)"},
    {"id": "title", "label": "Title (flat)"},
    {"id": "message", "label": "Message (flat)"},
    {"id": "env", "label": "Environment (flat)"},
    {"id": "site", "label": "Site (flat)"},
    {"id": "source_id", "label": "Source ID (flat)"},
    {"id": "timestamp", "label": "Timestamp (flat)"},
]

# In-memory saved patterns: id -> { id, name, source_type, mappings }
# mappings: [ { target_field_id, source_field_id | null, static_value | null }, ... ]
_saved_patterns: Dict[str, Dict[str, Any]] = {}


def list_schemas() -> Dict[str, Any]:
    """Return built-in source schemas and target fields for UI."""
    return {
        "source_schemas": SOURCE_SCHEMAS,
        "target_fields": TARGET_FIELDS,
    }


def list_patterns() -> List[Dict[str, Any]]:
    """Return all saved patterns (id, name, source_type, mappings)."""
    return list(_saved_patterns.values())


def get_pattern(pattern_id: str) -> Optional[Dict[str, Any]]:
    """Return one pattern by id."""
    return _saved_patterns.get(pattern_id)


def save_pattern(
    name: str,
    source_type: str,
    mappings: List[Dict[str, Any]],
    pattern_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Save or update a pattern. mappings: [ { target_field_id, source_field_id?, static_value? }, ... ]
    Returns the saved pattern { id, name, source_type, mappings }.
    """
    pid = pattern_id or str(uuid.uuid4())
    _saved_patterns[pid] = {
        "id": pid,
        "name": name,
        "source_type": source_type,
        "mappings": mappings,
    }
    return _saved_patterns[pid]


def delete_pattern(pattern_id: str) -> bool:
    """Remove a saved pattern. Returns True if removed."""
    if pattern_id in _saved_patterns:
        del _saved_patterns[pattern_id]
        return True
    return False


def init_patterns(patterns: List[Dict[str, Any]]) -> None:
    """Load patterns from storage (called on startup / config reload)."""
    _saved_patterns.clear()
    for p in patterns or []:
        pid = p.get("id")
        if pid and isinstance(p.get("mappings"), list):
            _saved_patterns[pid] = {
                "id": pid,
                "name": p.get("name") or "Unnamed",
                "source_type": p.get("source_type") or "",
                "mappings": p["mappings"],
            }


def build_transform_from_mapping(
    mappings: List[Dict[str, Any]],
    target_field_ids: Optional[List[str]] = None,
) -> TransformConfig:
    """
    Build TransformConfig from mapping list.
    Each mapping: { "target_field_id": str, "source_field_id": str | null, "static_value": str | null }
    If source_field_id is set: map that source path to target field (rename + output).
    If static_value is set: set target field to that value (enrich_static).
    When target_field_ids is not provided, allowed targets are taken from mappings (for custom target from upload).
    """
    target_ids = target_field_ids
    if target_ids is None:
        target_ids = list({m.get("target_field_id") for m in mappings if m.get("target_field_id")})
    if not target_ids:
        target_ids = [t["id"] for t in TARGET_FIELDS]
    rename: Dict[str, str] = {}
    output_fields: Dict[str, str] = {}
    enrich_static: Dict[str, Any] = {}
    include_paths: List[str] = []

    for m in mappings:
        target_id = m.get("target_field_id")
        if not target_id or target_id not in target_ids:
            continue
        source_id = m.get("source_field_id")
        static_val = m.get("static_value")

        if static_val is not None and static_val != "":
            enrich_static[target_id] = static_val
            output_fields[target_id] = f"$.{target_id}"
            continue
        if source_id:
            rename[source_id] = target_id
            output_fields[target_id] = f"$.{target_id}"
            include_paths.append(source_id)

    # Deduplicate include_paths; include parent paths for nested (e.g. labels, annotations)
    include_set = set(include_paths)
    for p in include_paths:
        parts = p.split(".")
        for i in range(1, len(parts)):
            include_set.add(".".join(parts[:i]))
    include_fields = sorted(include_set)

    return TransformConfig(
        include_fields=include_fields if include_fields else None,
        rename=rename if rename else None,
        enrich_static=enrich_static if enrich_static else None,
        output_template=OutputTemplate(type="flat", fields=output_fields) if output_fields else None,
    )
