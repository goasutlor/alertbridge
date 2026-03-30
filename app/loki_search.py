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
    # Promtail sets `container` from the pod's container name; `app` as a Loki label is optional
    # and may be missing. ALERTBRIDGE_K8S_APP_LABEL must match the main container name (e.g. alertbridge-lite).
    if ns and app:
        return (
            f'{{namespace="{_escape_label_value(ns)}",'
            f'container="{_escape_label_value(app)}"}}'
        )
    if app:
        return f'{{container="{_escape_label_value(app)}"}}'
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
            "or ALERTBRIDGE_K8S_NAMESPACE + ALERTBRIDGE_K8S_APP_LABEL (container name)"
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


async def diagnose_loki(hours: int = 24) -> Dict[str, Any]:
    """
    Run checks against Loki for operators: label names, sample values, and line counts
    for the configured stream (all lines vs |= "forward_failed").
    """
    hours_clamped = max(1, min(int(hours), 168))
    out: Dict[str, Any] = {
        "app_version": os.getenv("APP_VERSION", "unknown"),
        "git_sha": os.getenv("GIT_SHA", "unknown"),
        "loki_url_configured": bool(_loki_url()),
        "stream_selector": stream_selector(),
        "stream_selector_preview": stream_selector_preview(),
        "loki_label_names": None,
        "loki_label_names_error": None,
        "label_values_sample": {},
        "probe_hours": hours_clamped,
        "probe_logql_all_lines": None,
        "probe_lines_all_lines": None,
        "probe_logql_forward_failed": None,
        "probe_lines_forward_failed": None,
        "probe_logql_namespace_only": None,
        "probe_lines_namespace_only": None,
        "errors": [],
        "diagnose_hints": [],
        "loki_labels_note": None,
    }
    base = _loki_url()
    if not base:
        out["errors"].append("ALERTBRIDGE_LOKI_URL not set")
        return out
    sel = stream_selector()
    if not sel:
        out["errors"].append(
            "Stream selector empty: set ALERTBRIDGE_K8S_NAMESPACE + ALERTBRIDGE_K8S_APP_LABEL "
            "or ALERTBRIDGE_LOKI_STREAM_SELECTOR"
        )
        return out

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0)) as client:
            resp = await client.get(f"{base}/loki/api/v1/labels", headers=_loki_headers())
        if resp.status_code == 200:
            j = resp.json()
            if isinstance(j, dict):
                raw_data = j.get("data")
                out["loki_label_names"] = raw_data if raw_data is not None else []
                if raw_data is None and j.get("status") == "success":
                    out["loki_labels_note"] = (
                        "Loki returned 200 with no 'data' key — often an empty store / "
                        "no ingested streams yet (same as earlier curl showing only {\"status\":\"success\"})."
                    )
            else:
                out["loki_label_names"] = None
        else:
            out["loki_label_names_error"] = f"HTTP {resp.status_code}: {resp.text[:300]}"
    except Exception as exc:
        out["loki_label_names_error"] = str(exc)

    names = out.get("loki_label_names") or []
    for lbl in ("namespace", "container", "pod", "app"):
        if lbl in names:
            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(15.0)) as client:
                    resp = await client.get(
                        f"{base}/loki/api/v1/label/{lbl}/values",
                        headers=_loki_headers(),
                    )
                if resp.status_code == 200:
                    j = resp.json()
                    vals = j.get("data") or []
                    out["label_values_sample"][lbl] = vals[:40]
                else:
                    out["label_values_sample"][lbl] = f"HTTP {resp.status_code}"
            except Exception as exc:
                out["label_values_sample"][lbl] = f"error: {exc}"

    out["probe_logql_all_lines"] = sel
    ent_all, err_all = await query_loki(sel, hours_clamped, 50)
    if err_all:
        out["errors"].append(f"query_range (all lines): {err_all}")
        out["probe_lines_all_lines"] = None
    else:
        out["probe_lines_all_lines"] = len(ent_all)

    q_ff = sel + ' |= "forward_failed"'
    out["probe_logql_forward_failed"] = q_ff
    ent_ff, err_ff = await query_loki(q_ff, hours_clamped, 50)
    if err_ff:
        out["errors"].append(f'query_range (forward_failed): {err_ff}')
        out["probe_lines_forward_failed"] = None
    else:
        out["probe_lines_forward_failed"] = len(ent_ff)

    ns = _k8s_namespace()
    if ns and out.get("probe_lines_all_lines") == 0:
        ns_sel = f'{{namespace="{_escape_label_value(ns)}"}}'
        out["probe_logql_namespace_only"] = ns_sel
        ent_ns, err_ns = await query_loki(ns_sel, hours_clamped, 50)
        if err_ns:
            out["errors"].append(f"query_range (namespace only): {err_ns}")
            out["probe_lines_namespace_only"] = None
        else:
            out["probe_lines_namespace_only"] = len(ent_ns)

    if out.get("probe_lines_all_lines") == 0:
        hints = out.setdefault("diagnose_hints", [])
        hints.append(
            "No log lines matched this stream in Loki for the selected hours. "
            "Promtail may not be shipping, or labels differ (check container name vs ALERTBRIDGE_K8S_APP_LABEL)."
        )
        hints.append(
            'If forward_failed is also 0: either no lines exist, or no line contains the text "forward_failed" '
            "(JSON log message field)."
        )
        n_only = out.get("probe_lines_namespace_only")
        if n_only is not None:
            if n_only > 0:
                hints.append(
                    f"Namespace-only probe found {n_only} line(s) in «{ns}» but not for container="
                    f"«{_k8s_app_label() or '?'}». Set ALERTBRIDGE_K8S_APP_LABEL to the real container name "
                    "or set ALERTBRIDGE_LOKI_STREAM_SELECTOR to match Promtail labels (Verify stream / Loki labels)."
                )
            elif ns:
                hints.append(
                    f"No lines for {{namespace=\"{ns}\"}} either — Loki is empty for this namespace or Promtail "
                    "is not pushing (oc logs -n … ds/promtail; SCC privileged for promtail; client URL → Loki push)."
                )
    elif out.get("probe_lines_forward_failed") == 0 and (out.get("probe_lines_all_lines") or 0) > 0:
        out.setdefault("diagnose_hints", []).append(
            "Logs exist for the stream but none contain the substring forward_failed in that window; "
            "try Filter « All lines » or widen the time range."
        )

    return out


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
