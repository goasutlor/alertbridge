"""Tests for forwarder security (SSRF mitigation) and retry behaviour."""
import asyncio
from unittest.mock import AsyncMock, MagicMock

import httpx

from app.forwarder import BACKOFF_SCHEDULE, _is_safe_forward_url, forward_payload
from app.rules import Defaults, MatchConfig, RouteConfig, TargetConfig, TransformConfig


def _minimal_route(url: str = "http://127.0.0.1:9/x") -> RouteConfig:
    return RouteConfig(
        name="test-route",
        match=MatchConfig(source="src"),
        target=TargetConfig(url_env="UNUSED_FORWARDER_TEST", url=url),
        transform=TransformConfig(),
    )


def test_safe_forward_url_allows_https_and_http():
    assert _is_safe_forward_url("https://example.com/webhook") is True
    assert _is_safe_forward_url("http://localhost:8080/hook") is True


def test_safe_forward_url_rejects_dangerous_schemes():
    assert _is_safe_forward_url("file:///etc/passwd") is False
    assert _is_safe_forward_url("gopher://internal/") is False
    assert _is_safe_forward_url("ftp://host/path") is False


def test_forward_retries_connect_error_until_backoff_exhausted(monkeypatch) -> None:
    """DNS / connection errors must retry like timeouts (not fail on attempt 1)."""
    calls = {"n": 0}

    async def failing_post(*args, **kwargs):
        calls["n"] += 1
        raise httpx.ConnectError("Name or service not known", request=MagicMock())

    mock_client = MagicMock()
    mock_client.post = AsyncMock(side_effect=failing_post)
    monkeypatch.setattr("app.forwarder._client_for_verify", lambda _verify: (mock_client, False))

    route = _minimal_route()
    defaults = Defaults(target_timeout_connect_sec=1, target_timeout_read_sec=1)
    ok, _status, _err, meta = asyncio.run(forward_payload({"a": 1}, route, "rid-1", defaults))

    assert ok is False
    assert calls["n"] == len(BACKOFF_SCHEDULE)
    assert meta["attempts_used"] == len(BACKOFF_SCHEDULE)
    assert meta["max_attempts"] == len(BACKOFF_SCHEDULE)
    assert meta["retried"] is True
