import asyncio
import os
import ssl
import time
from pathlib import Path
from typing import Any, Dict, Optional, Tuple, Union
from urllib.parse import urlparse, urlunparse

import httpx

from app.rules import Defaults, RouteConfig

_client: Optional[httpx.AsyncClient] = None

# Allowed target URL schemes only (no file:, gopher:, ftp: etc. to prevent SSRF)
ALLOWED_URL_SCHEMES = ("https", "http")
CHECK_TIMEOUT = httpx.Timeout(2.0, connect=1.5)

# Circuit breaker: per-route state
_circuit: Dict[str, Dict[str, Any]] = {}  # route_name -> {failures, last_fail, state}
CIRCUIT_FAILURE_THRESHOLD = 5
CIRCUIT_RESET_SECONDS = 60
CIRCUIT_STATE_CLOSED = "closed"
CIRCUIT_STATE_OPEN = "open"
CIRCUIT_STATE_HALF_OPEN = "half_open"

# Exponential backoff: 0, 1, 2, 4 seconds
BACKOFF_SCHEDULE = [0.0, 1.0, 2.0, 4.0]


def _is_safe_forward_url(url: str) -> bool:
    """Reject non-http(s) URLs to prevent SSRF via env-configured target."""
    try:
        parsed = urlparse(url)
        return bool(parsed.scheme and parsed.scheme.lower() in ALLOWED_URL_SCHEMES)
    except Exception:
        return False


def _build_verify(route: RouteConfig) -> Union[bool, ssl.SSLContext]:
    """
    Build verify param for httpx: True (default), False (skip), or SSLContext (custom CA).
    """
    target = route.target
    if getattr(target, "verify_tls", None) is False:
        return False
    ca_path = getattr(target, "ca_cert", None)
    if not ca_path and getattr(target, "ca_cert_env", None):
        ca_path = os.getenv(target.ca_cert_env, "").strip() or None
    if ca_path and Path(ca_path).exists():
        ctx = ssl.create_default_context(cafile=str(ca_path))
        return ctx
    return True


def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(follow_redirects=False)
    return _client


def _client_for_verify(verify: Union[bool, ssl.SSLContext]) -> Tuple[httpx.AsyncClient, bool]:
    """
    Return (client, should_close). Use global client when verify is True.
    For custom verify (False or SSLContext), create a transient client that must be closed.
    """
    if verify is True:
        return get_client(), False
    return httpx.AsyncClient(verify=verify, follow_redirects=False), True


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def _circuit_allow(route_name: str) -> bool:
    """Check if circuit allows request. Returns False if open."""
    c = _circuit.get(route_name, {})
    state = c.get("state", CIRCUIT_STATE_CLOSED)
    if state == CIRCUIT_STATE_CLOSED:
        return True
    if state == CIRCUIT_STATE_OPEN:
        last = c.get("last_fail", 0)
        if time.monotonic() - last >= CIRCUIT_RESET_SECONDS:
            _circuit[route_name] = {"failures": 0, "last_fail": last, "state": CIRCUIT_STATE_HALF_OPEN}
            return True
        return False
    return True  # half_open: allow one try


def _circuit_record(route_name: str, success: bool) -> None:
    """Record success/failure for circuit breaker."""
    c = _circuit.setdefault(route_name, {"failures": 0, "last_fail": 0, "state": CIRCUIT_STATE_CLOSED})
    if success:
        c["failures"] = 0
        c["state"] = CIRCUIT_STATE_CLOSED
    else:
        c["failures"] = c.get("failures", 0) + 1
        c["last_fail"] = time.monotonic()
        if c["failures"] >= CIRCUIT_FAILURE_THRESHOLD:
            c["state"] = CIRCUIT_STATE_OPEN
        elif c.get("state") == CIRCUIT_STATE_HALF_OPEN:
            c["state"] = CIRCUIT_STATE_OPEN


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

    if not _circuit_allow(route.name):
        return False, None, ValueError("Circuit breaker open (target degraded)")

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
            # Authorization header needs "Bearer " prefix for Bearer token auth
            if route.target.api_key_header.lower() == "authorization" and not api_key_value.lower().startswith("bearer "):
                api_key_value = f"Bearer {api_key_value}"
            headers[route.target.api_key_header] = api_key_value

    # httpx requires either a default or all four (connect, read, write, pool)
    timeout = httpx.Timeout(
        defaults.target_timeout_read_sec,
        connect=defaults.target_timeout_connect_sec,
    )

    verify: Union[bool, ssl.SSLContext] = _build_verify(route)
    client, should_close = _client_for_verify(verify)
    last_error: Optional[Exception] = None
    try:
        for attempt, delay in enumerate(BACKOFF_SCHEDULE, start=1):
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
                    if attempt < len(BACKOFF_SCHEDULE):
                        continue
                    _circuit_record(route.name, False)
                    return False, response.status_code, last_error
                _circuit_record(route.name, True)
                return response.is_success, response.status_code, None
            except httpx.ConnectTimeout as exc:
                last_error = exc
                if attempt < len(BACKOFF_SCHEDULE):
                    continue
                _circuit_record(route.name, False)
                return False, None, last_error
            except Exception as exc:
                _circuit_record(route.name, False)
                return False, None, exc

        _circuit_record(route.name, False)
        return False, None, last_error
    finally:
        if should_close:
            await client.aclose()


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
            if route.target.api_key_header.lower() == "authorization" and not api_key_value.lower().startswith("bearer "):
                api_key_value = f"Bearer {api_key_value}"
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
    verify = _build_verify(route)
    client, should_close = _client_for_verify(verify)
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
            return {"route": route.name, "target_url": url, "phase1_ok": False, "phase2_ok": False, "error": f"Phase1: {type(e).__name__} — {str(e)}"}
        # Phase 2: API handshake (POST with auth)
        headers = _build_forward_headers(route)
        timeout = httpx.Timeout(defaults.target_timeout_read_sec, connect=defaults.target_timeout_connect_sec)
        try:
            r = await client.post(url, json={}, headers=headers, timeout=timeout)
            phase2_ok = 200 <= r.status_code < 300
            if not phase2_ok:
                error_msg = f"Phase2: HTTP {r.status_code}"
        except (httpx.ConnectError, httpx.TimeoutException, httpx.RequestError) as e:
            error_msg = f"Phase2: {type(e).__name__} — {str(e)}"
    except Exception as e:
        error_msg = str(e)
    finally:
        if should_close:
            await client.aclose()
    return {
        "route": route.name,
        "target_url": url,
        "phase1_ok": phase1_ok,
        "phase2_ok": phase2_ok,
        "error": error_msg,
    }
