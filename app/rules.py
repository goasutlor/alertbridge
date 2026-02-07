import copy
import re
from typing import Any, Dict, List, Optional, Tuple

from pydantic import BaseModel, Field


class Defaults(BaseModel):
    target_timeout_connect_sec: int = 2
    target_timeout_read_sec: int = 5


class MatchConfig(BaseModel):
    source: str


class TargetConfig(BaseModel):
    url_env: str
    """Env var name for target URL (used when url is not set)."""
    url: Optional[str] = None
    """Optional direct URL; if set, overrides url_env. Use for testing (e.g. http://127.0.0.1:9999/webhook)."""
    auth_header_env: Optional[str] = None
    """Optional env var for Authorization header value (e.g. 'Bearer ...')."""

    api_key_header: Optional[str] = None
    """Optional header name for outbound API key (e.g. 'X-API-Key')."""
    api_key_env: Optional[str] = None
    """Optional env var name containing outbound API key value."""
    api_key: Optional[str] = None
    """Optional outbound API key value (use env where possible)."""


class VerifyHmac(BaseModel):
    """Optional HMAC verification for webhook. Default: disabled."""
    secret_env: str
    header: str = "X-Signature-256"
    algorithm: str = "sha256"


class OutputTemplate(BaseModel):
    type: str = "flat"
    fields: Dict[str, str]


class TransformConfig(BaseModel):
    include_fields: Optional[List[str]] = None
    drop_fields: Optional[List[str]] = None
    rename: Optional[Dict[str, str]] = None
    enrich_static: Optional[Dict[str, Any]] = None
    map_values: Optional[Dict[str, Dict[str, str]]] = None
    output_template: Optional[OutputTemplate] = None


class RouteConfig(BaseModel):
    name: str
    match: MatchConfig
    target: TargetConfig
    transform: TransformConfig = Field(default_factory=TransformConfig)
    verify_hmac: Optional[VerifyHmac] = None


class BasicAuthUser(BaseModel):
    """Local user for Basic Auth. Password from env (no plain password in config)."""
    username: str
    password_env: str


class BasicAuthConfig(BaseModel):
    users: List[BasicAuthUser] = Field(default_factory=list)


class ApiKey(BaseModel):
    """API Key for webhook authentication."""
    name: str
    """Human-readable name for the API key."""
    key: str
    """The API key value (stored as-is in config)."""
    created_at: Optional[str] = None
    """ISO timestamp when key was created (optional)."""


class ApiKeyConfig(BaseModel):
    """API Key authentication configuration."""
    keys: List[ApiKey] = Field(default_factory=list)
    """List of valid API keys."""
    required: bool = True
    """If True, webhook requests require valid API key. If False, API key is optional."""


class AuthConfig(BaseModel):
    """Optional Basic Authentication. Default: off; can use env BASIC_AUTH_USER + BASIC_AUTH_PASSWORD."""
    basic: Optional[BasicAuthConfig] = None
    api_keys: Optional[ApiKeyConfig] = None


class RuleSet(BaseModel):
    version: int
    defaults: Defaults = Field(default_factory=Defaults)
    routes: List[RouteConfig] = Field(default_factory=list)
    auth: Optional[AuthConfig] = None


_PATH_SEGMENT = re.compile(r"([^\[\]]+)(?:\[(\d+)\])?")


def select_route(rules: RuleSet, source: str) -> Optional[RouteConfig]:
    for route in rules.routes:
        if route.match.source == source:
            return route
    return None


def transform_payload(payload: Any, route: RouteConfig) -> Any:
    working = copy.deepcopy(payload)
    config = route.transform

    if config.include_fields:
        working = _apply_include_fields(working, config.include_fields)

    if config.drop_fields:
        for path in config.drop_fields:
            _delete_by_path(working, path)

    if config.rename:
        for src, dst in config.rename.items():
            found, value = _get_by_path(working, src)
            if found:
                _set_by_path(working, dst, value)
                _delete_by_path(working, src)

    if config.enrich_static:
        if isinstance(working, dict):
            for key, value in config.enrich_static.items():
                working[key] = value

    if config.map_values:
        for path, mapping in config.map_values.items():
            found, value = _get_by_path(working, path)
            if found and value in mapping:
                _set_by_path(working, path, mapping[value])

    if config.output_template:
        return _apply_output_template(working, config.output_template)

    return working


def sanitize_payload(payload: Any) -> Any:
    sensitive_keys = ("secret", "token", "auth", "password", "key")
    if isinstance(payload, dict):
        sanitized = {}
        for key, value in payload.items():
            if any(word in key.lower() for word in sensitive_keys):
                sanitized[key] = "***"
            else:
                sanitized[key] = sanitize_payload(value)
        return sanitized
    if isinstance(payload, list):
        return [sanitize_payload(item) for item in payload]
    return payload


def _apply_include_fields(payload: Any, paths: List[str]) -> Any:
    if not isinstance(payload, dict):
        return payload

    result: Dict[str, Any] = {}
    for path in paths:
        found, value = _get_by_path(payload, path)
        if found:
            _set_by_path(result, path, value)
    return result


def _apply_output_template(payload: Any, template: OutputTemplate) -> Dict[str, Any]:
    output: Dict[str, Any] = {}
    for key, selector in template.fields.items():
        output[key] = _select_jsonpath(payload, selector)
    return output


def _select_jsonpath(payload: Any, selector: str) -> Any:
    if selector == "$":
        return payload
    if not selector.startswith("$."):
        return None
    path = selector[2:]
    found, value = _get_by_path(payload, path)
    if found:
        return value
    return None


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


def _set_by_path(data: Any, path: str, value: Any) -> None:
    if not isinstance(data, dict):
        return
    current: Any = data
    segments = _parse_path(path)
    for i, (key, idx) in enumerate(segments):
        is_last = i == len(segments) - 1
        if idx is None:
            if is_last:
                current[key] = value
                return
            if key not in current or not isinstance(current[key], (dict, list)):
                current[key] = {}
            current = current[key]
            continue

        if key not in current or not isinstance(current[key], list):
            current[key] = []
        target_list = current[key]
        while len(target_list) <= idx:
            target_list.append({})
        if is_last:
            target_list[idx] = value
            return
        if not isinstance(target_list[idx], dict):
            target_list[idx] = {}
        current = target_list[idx]


def _delete_by_path(data: Any, path: str) -> None:
    if not isinstance(data, dict):
        return
    current: Any = data
    segments = _parse_path(path)
    for i, (key, idx) in enumerate(segments):
        is_last = i == len(segments) - 1
        if not isinstance(current, dict) or key not in current:
            return
        if is_last:
            if idx is None:
                current.pop(key, None)
            else:
                target = current.get(key)
                if isinstance(target, list) and 0 <= idx < len(target):
                    target.pop(idx)
            return
        current = current[key]
        if idx is not None:
            if isinstance(current, list) and 0 <= idx < len(current):
                current = current[idx]
            else:
                return
