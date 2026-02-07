import asyncio
import os
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlparse, urlunparse

import httpx

from app.rules import Defaults, RouteConfig

_client: Optional[httpx.AsyncClient] = None

# Allowed target URL schemes only (no file:, gopher:, ftp: etc. to prevent SSRF)
ALLOWED_URL_SCHEMES = ("https", "http")
CHECK_TIMEOUT = httpx.Timeout(2.0, connect=1.5)


def _is_safe_forward_url(url: str) -> bool:
    """Reject non-http(s) URLs to prevent SSRF via env-configured target."""
    try:
        parsed = urlparse(url)
        return bool(parsed.scheme and parsed.scheme.lower() in ALLOWED_URL_SCHEMES)
    except Exception:
        return False


def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(follow_redirects=False)
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


async def forward_payload(
    payload: Any,
    route: RouteConfig,
    request_id: str,
    defaults: Defaults,
) -> Tuple[bool, Optional[int], Optional[Exception]]:
    url = (route.target.url or "").strip() or os.getenv(route.target.url_env)
    if not url:
        return False, None, ValueError(f"Missing target URL (set url in config or env {route.target.url_env})")
    if not _is_safe_forward_url(url):
        return False, None, ValueError(f"Target URL scheme or host not allowed")

    headers = {"Content-Type": "application/json", "X-Request-ID": request_id}
    if route.target.auth_header_env:
        auth_value = os.getenv(route.target.auth_header_env)
        if auth_value:
            headers["Authorization"] = auth_value

    # Optional outbound API key header (per-route)
    if route.target.api_key_header:
        api_key_value = None
        if route.target.api_key_env:
            api_key_value = os.getenv(route.target.api_key_env)
        if not api_key_value and route.target.api_key:
            api_key_value = route.target.api_key
        if api_key_value:
            headers[route.target.api_key_header] = api_key_value

    # httpx requires either a default or all four (connect, read, write, pool)
    timeout = httpx.Timeout(
        defaults.target_timeout_read_sec,
        connect=defaults.target_timeout_connect_sec,
    )

    backoff_schedule = [0.0, 0.2, 0.5]
    client = get_client()
    last_error: Optional[Exception] = None
    for attempt, delay in enumerate(backoff_schedule, start=1):
        if delay > 0:
            await asyncio.sleep(delay)
        try:
            response = await client.post(
                url,
                json=payload,
                headers=headers,
                timeout=timeout,
            )
            if response.status_code >= 500:
                last_error = httpx.HTTPStatusError(
                    "Target returned 5xx", request=response.request, response=response
                )
                if attempt < len(backoff_schedule):
                    continue
                return False, response.status_code, last_error
            return response.is_success, response.status_code, None
        except httpx.ConnectTimeout as exc:
            last_error = exc
            if attempt < len(backoff_schedule):
                continue
            return False, None, last_error
        except Exception as exc:
            return False, None, exc

    return False, None, last_error


def _build_forward_headers(route: RouteConfig) -> Dict[str, str]:
    """Build headers used for forwarding (auth, content-type)."""
    headers: Dict[str, str] = {"Content-Type": "application/json", "X-Request-ID": "target-status-check"}
    if route.target.auth_header_env:
        auth_value = os.getenv(route.target.auth_header_env)
        if auth_value:
            headers["Authorization"] = auth_value
    if route.target.api_key_header:
        api_key_value = None
        if route.target.api_key_env:
            api_key_value = os.getenv(route.target.api_key_env)
        if not api_key_value and route.target.api_key:
            api_key_value = route.target.api_key
        if api_key_value:
            headers[route.target.api_key_header] = api_key_value
    return headers


def _base_url(url: str) -> str:
    """Return scheme://netloc (origin) from URL."""
    try:
        p = urlparse(url)
        return urlunparse((p.scheme, p.netloc, "", "", "", ""))
    except Exception:
        return url


async def check_target_status(route: RouteConfig, defaults: Defaults) -> Dict[str, Any]:
    """
    Two-phase target reachability check.
    Phase 1: Server reachable (GET base URL).
    Phase 2: API handshake OK (POST with auth to webhook URL).
    """
    url = (route.target.url or "").strip() or os.getenv(route.target.url_env)
    if not url:
        return {"route": route.name, "target_url": None, "phase1_ok": False, "phase2_ok": False, "error": "No target URL"}
    if not _is_safe_forward_url(url):
        return {"route": route.name, "target_url": url, "phase1_ok": False, "phase2_ok": False, "error": "Invalid URL scheme"}
    client = get_client()
    base = _base_url(url)
    phase1_ok = False
    phase2_ok = False
    error_msg: Optional[str] = None
    try:
        # Phase 1: Server reachable
        try:
            r = await client.get(f"{base.rstrip('/')}/", timeout=CHECK_TIMEOUT)
            phase1_ok = True
        except (httpx.ConnectError, httpx.TimeoutException, httpx.RequestError) as e:
            error_msg = f"Phase1: {type(e).__name__}"
            return {"route": route.name, "target_url": url, "phase1_ok": False, "phase2_ok": False, "error": str(e)}
        # Phase 2: API handshake (POST with auth)
        headers = _build_forward_headers(route)
        timeout = httpx.Timeout(defaults.target_timeout_read_sec, connect=defaults.target_timeout_connect_sec)
        try:
            r = await client.post(url, json={}, headers=headers, timeout=timeout)
            phase2_ok = 200 <= r.status_code < 300
            if not phase2_ok:
                error_msg = f"Phase2: HTTP {r.status_code}"
        except (httpx.ConnectError, httpx.TimeoutException, httpx.RequestError) as e:
            error_msg = f"Phase2: {type(e).__name__}"
    except Exception as e:
        error_msg = str(e)
    return {
        "route": route.name,
        "target_url": url,
        "phase1_ok": phase1_ok,
        "phase2_ok": phase2_ok,
        "error": error_msg,
    }
