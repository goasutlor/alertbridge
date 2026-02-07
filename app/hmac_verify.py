"""Optional HMAC signature verification for webhook requests. Default: disabled per route."""
import hmac
import hashlib
import os
from typing import Optional

from app.rules import RouteConfig, VerifyHmac


def verify_hmac(
    raw_body: bytes,
    header_value: Optional[str],
    route: RouteConfig,
) -> tuple[bool, Optional[str]]:
    """
    Verify request body against HMAC header using route.verify_hmac config.
    Returns (ok, error_message). If route has no verify_hmac, returns (True, None).
    """
    cfg: Optional[VerifyHmac] = getattr(route, "verify_hmac", None)
    if not cfg:
        return True, None

    secret = os.getenv(cfg.secret_env)
    if not secret:
        return False, f"Missing env {cfg.secret_env} for HMAC"

    if not _verify_digest(raw_body, header_value, secret, cfg.algorithm, header_prefix=True):
        return False, "HMAC signature invalid"
    return True, None


def _verify_digest(
    raw_body: bytes,
    header_value: Optional[str],
    secret: str,
    algorithm: str = "sha256",
    header_prefix: bool = True,
) -> bool:
    """Compare body digest with header using timing-safe comparison."""
    if not header_value or not secret:
        return False
    algo = algorithm.lower().replace("-", "")
    if algo == "sha256":
        digest = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    elif algo == "sha1":
        digest = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha1).hexdigest()
    else:
        return False

    expected = digest
    if header_prefix and "=" in header_value:
        parts = header_value.split("=", 1)
        if len(parts) == 2:
            header_value = parts[1].strip()
    return hmac.compare_digest(expected, header_value)
