"""Configuration and REST API pattern rules for Alarm Receiver."""
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml
from pydantic import BaseModel, Field

logger = logging.getLogger("alarm_receiver")

DEFAULT_RULES_PATH = Path(__file__).resolve().parent.parent / "config" / "patterns.yaml"
RULES_PATH = Path(os.getenv("ALARM_RECEIVER_RULES_PATH", str(DEFAULT_RULES_PATH)))

_rules_cache: Optional["PatternRules"] = None


class FieldMapping(BaseModel):
    """Map source JSON path to target field."""
    source_path: str  # e.g. "labels.severity", "annotations.summary"
    target_field: str  # e.g. "severity", "message"


class ApiPattern(BaseModel):
    """Custom REST API pattern - defines how to parse and map incoming payloads."""
    name: str
    source_id: str  # e.g. "ocp", "confluent", "custom"
    description: Optional[str] = None
    mappings: List[FieldMapping] = Field(default_factory=list)
    # Optional: static enrich fields
    enrich: Optional[Dict[str, Any]] = None


class PatternRules(BaseModel):
    version: int = 1
    patterns: List[ApiPattern] = Field(default_factory=list)


def load_rules() -> PatternRules:
    global _rules_cache
    if RULES_PATH.exists():
        try:
            with open(RULES_PATH, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            _rules_cache = PatternRules.model_validate(data)
            return _rules_cache
        except Exception as exc:
            logger.warning("Failed to load rules: %s", exc)
    _rules_cache = PatternRules()
    return _rules_cache


def get_rules() -> PatternRules:
    if _rules_cache is None:
        load_rules()
    return _rules_cache or PatternRules()


def get_pattern_by_source(source_id: str) -> Optional[ApiPattern]:
    """Exact match only."""
    rules = get_rules()
    for p in rules.patterns:
        if p.source_id == source_id:
            return p
    return None


def get_pattern_for_source(source_id: str) -> tuple[Optional[ApiPattern], Optional[str]]:
    """
    Resolve pattern for webhook path. Supports route aliases:
    - Exact: ocp -> OCP pattern
    - Prefix: ocp-alertmanager -> OCP pattern (part before first '-' used as schema)
    Returns (pattern, schema_id_used) for mapping and filtering.
    """
    rules = get_rules()
    # 1. Exact match
    for p in rules.patterns:
        if p.source_id == source_id:
            return p, p.source_id
    # 2. Case-insensitive match (New-OCP-Pattern -> new-ocp-pattern)
    for p in rules.patterns:
        if p.source_id.lower() == source_id.lower():
            return p, p.source_id
    # 3. Prefix alias: ocp-alertmanager -> try ocp
    if "-" in source_id:
        prefix = source_id.split("-")[0]
        for p in rules.patterns:
            if p.source_id == prefix:
                return p, p.source_id
    return None, None


def save_rules(rules: PatternRules) -> None:
    global _rules_cache
    RULES_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(RULES_PATH, "w", encoding="utf-8") as f:
        yaml.safe_dump(rules.model_dump(), f, sort_keys=False, allow_unicode=True)
    _rules_cache = rules
