import logging
import os
from pathlib import Path
from threading import RLock
from typing import Optional

import yaml

from app.rules import Defaults, RuleSet

logger = logging.getLogger("alertbridge")
RULES_PATH = Path(os.getenv("ALERTBRIDGE_RULES_PATH", "/etc/alertbridge/rules.yaml"))

# ConfigMap watch: poll interval (seconds). Set to 0 to disable auto-reload.
CONFIG_WATCH_INTERVAL = int(os.getenv("ALERTBRIDGE_CONFIG_WATCH_INTERVAL", "30"))

_lock = RLock()
_rules_cache: Optional[RuleSet] = None
_rules_loaded = False


def _rules_dict_with_patterns(rules: RuleSet) -> dict:
    """Merge patterns into rules dict for persistence."""
    from app.patterns import list_patterns

    data = rules.model_dump()
    data["patterns"] = list_patterns()
    return data


def persist_rules(rules: RuleSet) -> None:
    """
    Save rules permanently: patch ConfigMap when ALERTBRIDGE_CONFIGMAP_NAME is set (OCP),
    otherwise write to file. Includes saved patterns so they survive pod restart.
    Raises PermissionError if both methods fail.
    """
    from app.k8s_configmap import persist_rules_to_configmap

    rules_yaml = yaml.safe_dump(_rules_dict_with_patterns(rules), sort_keys=False)

    if persist_rules_to_configmap(rules_yaml):
        return

    try:
        save_rules_to_file(rules)
    except PermissionError:
        raise PermissionError(
            "Config is read-only. Set ALERTBRIDGE_CONFIGMAP_NAME and RBAC for ConfigMap patch, "
            "or update ConfigMap manually and call /admin/reload."
        )


def load_rules_from_file(path: Path = RULES_PATH) -> RuleSet:
    from app.patterns import init_patterns

    if not path.exists():
        return RuleSet(version=1, defaults=Defaults(), routes=[])
    with path.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    patterns = data.pop("patterns", None)
    init_patterns(patterns)
    return RuleSet.model_validate(data)


def save_rules_to_file(rules: RuleSet, path: Path = RULES_PATH) -> None:
    """Save rules and patterns to file. Use _rules_dict_with_patterns for full persistence."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        yaml.safe_dump(_rules_dict_with_patterns(rules), handle, sort_keys=False)


def set_rules(rules: RuleSet) -> None:
    global _rules_cache, _rules_loaded
    with _lock:
        _rules_cache = rules
        _rules_loaded = True


def get_rules() -> RuleSet:
    global _rules_cache
    with _lock:
        if _rules_cache is None:
            set_rules(load_rules_from_file())
        return _rules_cache


def reload_rules() -> RuleSet:
    rules = load_rules_from_file()
    set_rules(rules)
    return rules


def rules_loaded() -> bool:
    with _lock:
        return _rules_loaded


def get_rules_file_mtime() -> Optional[float]:
    """Return mtime of rules file, or None if not exists."""
    try:
        if RULES_PATH.exists():
            return RULES_PATH.stat().st_mtime
    except OSError:
        pass
    return None


def watch_and_reload() -> bool:
    """
    Check if rules file changed (by mtime) and reload if so.
    Returns True if reloaded.
    """
    if CONFIG_WATCH_INTERVAL <= 0:
        return False
    mtime = get_rules_file_mtime()
    if mtime is None:
        return False
    prev = getattr(watch_and_reload, "_last_mtime", None)
    watch_and_reload._last_mtime = mtime
    if prev is not None and mtime > prev:
        try:
            reload_rules()
            logger.info("Config auto-reload: rules file changed")
            return True
        except Exception as e:
            logger.warning("Config auto-reload failed: %s", e)
    return False
