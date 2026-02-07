"""
API Key management for Alert Receiver.
Generate keys, validate incoming requests - reject if API key not issued by this system.
"""
import json
import logging
import os
import secrets
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("alarm_receiver")

# Default path for API keys storage (JSON file)
DEFAULT_KEYS_PATH = Path(__file__).resolve().parent.parent / "data" / "api_keys.json"
KEYS_PATH = Path(os.getenv("ALARM_RECEIVER_KEYS_PATH", str(DEFAULT_KEYS_PATH)))

# In-memory cache: key_hash -> { name, created_at }
_keys_cache: Dict[str, Dict[str, Any]] = {}


def _ensure_data_dir() -> None:
    KEYS_PATH.parent.mkdir(parents=True, exist_ok=True)


def _load_keys() -> Dict[str, Dict[str, Any]]:
    """Load API keys from JSON file."""
    global _keys_cache
    if not KEYS_PATH.exists():
        return {}
    try:
        with open(KEYS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        # Format: { "key_prefix:hash": { "name", "created_at", "key_hash" } }
        _keys_cache = data.get("keys", {})
        return _keys_cache
    except Exception as exc:
        logger.warning("Failed to load API keys: %s", exc)
        return {}


def _save_keys(keys: Dict[str, Dict[str, Any]]) -> None:
    """Persist API keys to JSON file."""
    _ensure_data_dir()
    data = {"keys": keys, "version": 1}
    with open(KEYS_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    global _keys_cache
    _keys_cache = keys


def _get_keys() -> Dict[str, Dict[str, Any]]:
    if not _keys_cache and KEYS_PATH.exists():
        _load_keys()
    return _keys_cache


def generate_api_key(name: str = "default") -> str:
    """
    Generate a new API key. Format: alarm_<32 hex chars>
    Returns the plain key (shown once to user). Store only a hash for validation.
    """
    plain_key = f"alarm_{secrets.token_hex(16)}"
    # For validation we use a simple prefix match - store first 8 chars as lookup
    # and full key in a way we can verify. For simplicity we store: prefix -> { full_key_hash }
    import hashlib
    key_hash = hashlib.sha256(plain_key.encode()).hexdigest()
    prefix = plain_key[:20]  # alarm_ + 14 hex for lookup hint

    keys = _get_keys()
    # Store by a unique id
    entry_id = f"key_{secrets.token_hex(4)}"
    keys[entry_id] = {
        "name": name,
        "key_hash": key_hash,
        "prefix": prefix,
        "created_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
    }
    _save_keys(keys)
    logger.info("Generated API key for name=%s", name)
    return plain_key


def validate_api_key(api_key: Optional[str]) -> bool:
    """
    Validate that the API key was issued by this system.
    Returns True if valid, False otherwise.
    """
    if not api_key or not api_key.strip():
        return False
    api_key = api_key.strip()
    if not api_key.startswith("alarm_"):
        return False

    import hashlib
    key_hash = hashlib.sha256(api_key.encode()).hexdigest()
    keys = _get_keys()
    for entry in keys.values():
        if entry.get("key_hash") == key_hash:
            return True
    return False


def list_api_keys() -> List[Dict[str, Any]]:
    """List all issued API keys (without exposing the actual key)."""
    keys = _get_keys()
    return [
        {
            "id": kid,
            "name": v.get("name", "unnamed"),
            "prefix": v.get("prefix", "")[:12] + "...",
            "created_at": v.get("created_at"),
        }
        for kid, v in keys.items()
    ]


def revoke_api_key(identifier: str) -> bool:
    """Revoke an API key by id. Returns True if found and removed."""
    keys = _get_keys()
    if identifier in keys:
        del keys[identifier]
        _save_keys(keys)
        return True
    return False
