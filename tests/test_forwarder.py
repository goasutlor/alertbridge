"""Tests for forwarder security (SSRF mitigation)."""
from app.forwarder import _is_safe_forward_url


def test_safe_forward_url_allows_https_and_http():
    assert _is_safe_forward_url("https://example.com/webhook") is True
    assert _is_safe_forward_url("http://localhost:8080/hook") is True


def test_safe_forward_url_rejects_dangerous_schemes():
    assert _is_safe_forward_url("file:///etc/passwd") is False
    assert _is_safe_forward_url("gopher://internal/") is False
    assert _is_safe_forward_url("ftp://host/path") is False
