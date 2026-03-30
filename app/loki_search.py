"""
Optional Loki query_range proxy for in-portal log search (no Grafana UI required).
Configure ALERTBRIDGE_LOKI_URL and stream labels so Promtail/Loki match this workload.
"""
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx

_SAFE_Q = re.compile(r"^[\w\s\-./:@#$%^&*()+=?\[\]{}|~,]{0,300}$")


def _loki_url() -> str:
    return os.getenv("ALERTBRIDGE_LOKI_URL", "").strip().rstrip("/")


def _stream_selector_raw() -> str:
    return os.getenv("ALERTBRIDGE_LOKI_STREAM_SELECTOR", "").strip()


def _k8s_namespace() -> str:
    return os.getenv("ALERTBRIDGE_K8S_NAMESPACE", "").strip()


def _k8s_app_label() -> str:
    return os.getenv("ALERTBRIDGE_K8S_APP_LABEL", "").strip()


def _loki_bearer() -> str:
    return os.getenv("ALERTBRIDGE_LOKI_BEARER_TOKEN", "").strip()


def logs_enabled() -> bool:
    return bool(_loki_url())


def _escape_label_value(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


def stream_selector() -> str:
    """Build `{label="value",...}` for LogQL."""
    raw = _stream_selector_raw()
    if raw:
        s = raw.strip()
        if not s.startswith("{"):
            return "{" + s + "}"
        return s
    ns = _k8s_namespace()
    app = _k8s_app_label()
    if ns and app:
        return (
            f'{{namespace="{_escape_label_value(ns)}",'
            f'app="{_escape_label_value(app)}"}}'
        )
    if app:
        return f'{{app="{_escape_label_value(app)}"}}'
    return ""


def stream_selector_preview() -> str:
    """Safe one-line description for UI (no secrets)."""
    s = stream_selector()
    return s if s else "(labels not configured)"


def build_logql(event: str, q: str) -> str:
    """
    event: all | errors | requests
    q: optional substring / regex fragment (validated)
    """
    sel = stream_selector()
    if not sel:
        raise ValueError(
            "Configure log stream labels: set ALERTBRIDGE_LOKI_STREAM_SELECTOR "
            "or ALERTBRIDGE_K8S_NAMESPACE + ALERTBRIDGE_K8S_APP_LABEL"
        )
    parts: List[str] = [sel]
    ev = (event or "all").lower().strip()
    if ev == "errors":
        parts.append(' |= "forward_failed"')
    elif ev == "requests":
        parts.append(' |= "request"')
    elif ev != "all":
        raise ValueError("event must be all, errors, or requests")

    text = (q or "").strip()
    if text:
        if len(text) > 300:
            raise ValueError("search text too long")
        if not _SAFE_Q.match(text):
            raise ValueError("invalid characters in search text")
        parts.append(f' |~ "{re.escape(text)}"')

    return "".join(parts)


def _loki_headers() -> Dict[str, str]:
    h: Dict[str, str] = {}
    tok = _loki_bearer()
    if tok:
        h["Authorization"] = f"Bearer {tok}"
    return h


async def loki_ready() -> Tuple[bool, Optional[str]]:
    """
    Check Loki /ready (or connectivity). Returns (ok, error_detail).
    """
    base = _loki_url()
    if not base:
        return False, None
    if not stream_selector():
        return False, "stream labels not set"
    url = f"{base}/ready"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(5.0)) as client:
            resp = await client.get(url, headers=_loki_headers())
        if resp.status_code == 200:
            return True, None
        return False, f"HTTP {resp.status_code}"
    except httpx.RequestError as exc:
        return False, str(exc)
    except Exception as exc:
        return False, str(exc)


async def query_loki(logql: str, hours: int, limit: int) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """
    Call Loki query_range. Returns (entries, error_message).
    Each entry: { "ts": ns, "line": str, "labels": dict }
    """
    base = _loki_url()
    if not base:
        return [], "Log search is not configured (ALERTBRIDGE_LOKI_URL empty)"

    end_ns = int(time.time() * 1_000_000_000)
    start_ns = int((time.time() - float(hours) * 3600.0) * 1_000_000_000)

    params = {
        "query": logql,
        "limit": str(limit),
        "start": str(start_ns),
        "end": str(end_ns),
    }
    url = f"{base}/loki/api/v1/query_range"

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
            resp = await client.get(url, params=params, headers=_loki_headers())
    except httpx.RequestError as exc:
        return [], f"Loki request failed: {exc}"

    if resp.status_code >= 400:
        return [], f"Loki returned {resp.status_code}: {resp.text[:500]}"

    try:
        data = resp.json()
    except Exception as exc:
        return [], f"Invalid JSON from Loki: {exc}"

    entries: List[Dict[str, Any]] = []
    result = (data.get("data") or {}).get("result") or []
    for stream in result:
        labels = stream.get("stream") or {}
        for ts_ns, line in stream.get("values") or []:
            entries.append({"ts": ts_ns, "line": line, "labels": labels})

    entries.sort(key=lambda x: int(x["ts"]), reverse=True)
    return entries[:limit], None
