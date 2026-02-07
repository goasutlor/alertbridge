"""Tests for optional HMAC verification (default off)."""
import os
from unittest.mock import patch

import pytest

from app.hmac_verify import verify_hmac, _verify_digest
from app.rules import MatchConfig, RouteConfig, TargetConfig, TransformConfig, VerifyHmac


def _route(verify_hmac_config=None):
    return RouteConfig(
        name="test",
        match=MatchConfig(source="test"),
        target=TargetConfig(url_env="TARGET_URL"),
        transform=TransformConfig(),
        verify_hmac=verify_hmac_config,
    )


def test_verify_hmac_disabled_by_default():
    """When route has no verify_hmac, verification is skipped."""
    route = _route(verify_hmac_config=None)
    ok, err = verify_hmac(b'{"a":1}', None, route)
    assert ok is True
    assert err is None


def test_verify_digest_sha256():
    """_verify_digest accepts sha256=hexdigest or raw hexdigest."""
    import hmac
    import hashlib
    body = b"hello"
    secret = "mysecret"
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    assert _verify_digest(body, f"sha256={expected}", secret, "sha256", header_prefix=True) is True
    assert _verify_digest(body, expected, secret, "sha256", header_prefix=False) is True
    assert _verify_digest(body, "wrong", secret, "sha256", header_prefix=False) is False


def test_verify_hmac_missing_secret_env():
    """When verify_hmac is set but secret env is missing, verification fails."""
    route = _route(verify_hmac_config=VerifyHmac(secret_env="MISSING_SECRET"))
    with patch.dict(os.environ, {}, clear=False):
        if "MISSING_SECRET" in os.environ:
            del os.environ["MISSING_SECRET"]
        ok, err = verify_hmac(b"{}", "sha256=abc", route)
    assert ok is False
    assert "MISSING_SECRET" in (err or "")


def test_verify_hmac_invalid_signature():
    """When signature does not match body+secret, verification fails."""
    route = _route(verify_hmac_config=VerifyHmac(secret_env="HMAC_SECRET"))
    with patch.dict(os.environ, {"HMAC_SECRET": "secret"}):
        ok, err = verify_hmac(b'{"x":1}', "sha256=invalid", route)
    assert ok is False
    assert "invalid" in (err or "").lower()
