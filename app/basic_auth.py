"""Optional Basic Authentication for local users. Default: off."""
import base64
import hmac
import os
from typing import List, Optional, Tuple

from fastapi import HTTPException, Request, status

from app.config import get_rules


def _get_local_users() -> List[Tuple[str, str]]:
    """
    Return list of (username, password) from config auth.basic.users (password from env)
    or from env BASIC_AUTH_USER + BASIC_AUTH_PASSWORD (single user).
    """
    rules = get_rules()
    users: List[Tuple[str, str]] = []

    if rules.auth and rules.auth.basic and rules.auth.basic.users:
        for u in rules.auth.basic.users:
            pwd = os.getenv(u.password_env)
            if pwd is not None:
                users.append((u.username, pwd))
        if users:
            return users

    # Fallback: single user from env
    username = os.getenv("BASIC_AUTH_USER")
    password = os.getenv("BASIC_AUTH_PASSWORD")
    if username and password:
        return [(username, password)]

    return []


def _parse_basic_header(auth_header: Optional[str]) -> Optional[Tuple[str, str]]:
    """Parse 'Basic base64(username:password)' -> (username, password) or None."""
    if not auth_header or not auth_header.strip().lower().startswith("basic "):
        return None
    try:
        token = auth_header.strip().split(maxsplit=1)[1]
        raw = base64.b64decode(token, validate=True).decode("utf-8")
        if ":" not in raw:
            return None
        user, _, pwd = raw.partition(":")
        return (user, pwd)
    except Exception:
        return None


def require_basic_auth(request: Request) -> Optional[str]:
    """
    Dependency for protected routes. When local users are configured, requires valid Basic Auth.
    When no users are configured, allows request (returns None). Returns username when authenticated.
    """
    users = _get_local_users()
    if not users:
        return None

    creds = _parse_basic_header(request.headers.get("Authorization"))
    if not creds:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
            headers={"WWW-Authenticate": "Basic realm=\"alertbridge-lite\""},
        )

    username, password = creds
    for u, p in users:
        if u == username and hmac.compare_digest(p, password):
            return username

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid username or password",
        headers={"WWW-Authenticate": "Basic realm=\"alertbridge-lite\""},
    )
