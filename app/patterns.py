"""
Alert source patterns and field mapping for the Bridge.
Primary schema: Red Hat OpenShift Alertmanager 4.20.10 (all inbound webhooks use /webhook/ocp).
User can map source fields (left) to target fields (right), save as pattern, apply to route.
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from app.rules import (
    ConcatTemplateSpec,
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
            # Top-level (webhook / group)
            {"id": "status", "label": "status"},
            {"id": "receiver", "label": "receiver"},
            {"id": "externalURL", "label": "externalURL"},
            {"id": "version", "label": "version"},
            {"id": "truncatedAlerts", "label": "truncatedAlerts"},
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
            {"id": "alerts.0.status", "label": "alerts[0].status"},
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
# mappings: [ { target_field_id, source_field_id | null, source_field_ids | null, static_value | null }, ... ]
_saved_patterns: Dict[str, Dict[str, Any]] = {}

BANGKOK = timezone(timedelta(hours=7))


def _now_bangkok_iso() -> str:
    return datetime.now(BANGKOK).isoformat(timespec="seconds")


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


def find_pattern_id_by_name(name: str) -> Optional[str]:
    """
    If a saved pattern uses this exact name (trimmed), return its id.
    When multiple exist (legacy duplicates), prefer the most recently updated.
    """
    n = (name or "").strip()
    if not n:
        return None
    best_id: Optional[str] = None
    best_ts = ""
    for pid, p in _saved_patterns.items():
        if (p.get("name") or "").strip() != n:
            continue
        ts = (p.get("updated_at") or p.get("created_at") or "") or ""
        if ts >= best_ts:
            best_ts = ts
            best_id = pid
    return best_id


def save_pattern(
    name: str,
    source_type: str,
    mappings: List[Dict[str, Any]],
    severity_from_resolved_status: bool = False,
    pattern_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Save or update a pattern. mappings: [ { target_field_id, source_field_id?, static_value? }, ... ]
    Returns the saved pattern { id, name, source_type, mappings }.
    When pattern_id is omitted, updates an existing row with the same name if present (no duplicate names).
    """
    if pattern_id is not None:
        pid = pattern_id
    else:
        existing = find_pattern_id_by_name(name)
        pid = existing if existing else str(uuid.uuid4())
    old = _saved_patterns.get(pid) or {}
    created_at = old.get("created_at") or _now_bangkok_iso()
    _saved_patterns[pid] = {
        "id": pid,
        "name": name,
        "source_type": source_type,
        "mappings": mappings,
        "severity_from_resolved_status": bool(severity_from_resolved_status),
        "created_at": created_at,
        "updated_at": _now_bangkok_iso(),
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
                "severity_from_resolved_status": bool(p.get("severity_from_resolved_status", False)),
                "created_at": p.get("created_at"),
                "updated_at": p.get("updated_at"),
            }


def _include_path_and_parents(include_set: set, path: str) -> None:
    include_set.add(path)
    parts = path.split(".")
    for i in range(1, len(parts)):
        include_set.add(".".join(parts[:i]))


def build_transform_from_mapping(
    mappings: List[Dict[str, Any]],
    target_field_ids: Optional[List[str]] = None,
    severity_from_resolved_status: bool = False,
) -> TransformConfig:
    """
    Build TransformConfig from mapping list.
    Each mapping: { "target_field_id": str, "source_field_id": str | null, "static_value": str | null }
    Optional: "source_field_ids": [ "path1", "path2", ... ] — try paths in order; first non-empty value wins
    (fallback for Alertmanager shapes). Mutually preferred over a single source_field_id for that row.
    Optional: "concat_template": "[{0}] {1}", "concat_paths": ["alerts.0.status", "alerts.0.annotations.description"] —
    combine those paths with Python str.format ({0}, {1}, …). Takes precedence over static / coalesce / single source.
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
    coalesce_sources: Dict[str, List[str]] = {}
    concat_templates: Dict[str, ConcatTemplateSpec] = {}
    include_set: set = set()

    for m in mappings:
        target_id = m.get("target_field_id")
        if not target_id or target_id not in target_ids:
            continue
        source_id = m.get("source_field_id")
        static_val = m.get("static_value")
        raw_sids = m.get("source_field_ids")
        raw_concat = m.get("concat_template")
        raw_cpaths = m.get("concat_paths")

        if raw_concat is not None and str(raw_concat).strip():
            paths_ct: List[str] = []
            if isinstance(raw_cpaths, list):
                paths_ct = [str(x).strip() for x in raw_cpaths if x is not None and str(x).strip()]
            if paths_ct:
                concat_templates[target_id] = ConcatTemplateSpec(
                    template=str(raw_concat).strip(),
                    paths=paths_ct,
                )
                output_fields[target_id] = f"$.{target_id}"
                for p in paths_ct:
                    _include_path_and_parents(include_set, p)
                continue

        if static_val is not None and static_val != "":
            enrich_static[target_id] = static_val
            output_fields[target_id] = f"$.{target_id}"
            continue
        if isinstance(raw_sids, list) and len(raw_sids) > 0:
            paths = [str(x).strip() for x in raw_sids if x is not None and str(x).strip()]
            if not paths:
                continue
            coalesce_sources.setdefault(target_id, []).extend(paths)
            output_fields[target_id] = f"$.{target_id}"
            for p in paths:
                _include_path_and_parents(include_set, p)
            continue
        if source_id:
            rename[source_id] = target_id
            output_fields[target_id] = f"$.{target_id}"
            _include_path_and_parents(include_set, source_id)

    include_fields = sorted(include_set)

    return TransformConfig(
        include_fields=include_fields if include_fields else None,
        rename=rename if rename else None,
        coalesce_sources=coalesce_sources if coalesce_sources else None,
        enrich_static=enrich_static if enrich_static else None,
        concat_templates=concat_templates if concat_templates else None,
        severity_from_resolved_status=bool(severity_from_resolved_status),
        output_template=OutputTemplate(type="flat", fields=output_fields) if output_fields else None,
    )
