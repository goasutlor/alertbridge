"""Tests for optional Basic Auth (local users)."""
import base64
import os
from unittest.mock import patch

from app.basic_auth import _get_local_users, _parse_basic_header
from app.rules import AuthConfig, BasicAuthConfig, BasicAuthUser, Defaults, RuleSet


def test_parse_basic_header():
    raw = base64.b64encode(b"user:pass").decode()
    assert _parse_basic_header(f"Basic {raw}") == ("user", "pass")
    assert _parse_basic_header("Basic invalid!!!") is None
    assert _parse_basic_header(None) is None
    assert _parse_basic_header("Bearer token") is None


def test_get_local_users_from_env():
    rules_no_auth = RuleSet(version=1, defaults=Defaults(), routes=[], auth=None)
    with (
        patch("app.basic_auth.get_rules", return_value=rules_no_auth),
        patch.dict(os.environ, {"BASIC_AUTH_USER": "admin", "BASIC_AUTH_PASSWORD": "secret"}),
    ):
        users = _get_local_users()
    assert users == [("admin", "secret")]


def test_get_local_users_from_config():
    rules_with_auth = RuleSet(
        version=1,
        defaults=Defaults(),
        routes=[],
        auth=AuthConfig(
            basic=BasicAuthConfig(
                users=[
                    BasicAuthUser(username="u1", password_env="P1"),
                    BasicAuthUser(username="u2", password_env="P2"),
                ]
            )
        ),
    )
    with (
        patch("app.basic_auth.get_rules", return_value=rules_with_auth),
        patch.dict(os.environ, {"P1": "pass1", "P2": "pass2"}),
    ):
        users = _get_local_users()
    assert set(users) == {("u1", "pass1"), ("u2", "pass2")}


def test_get_local_users_empty_when_no_config():
    rules_no_auth = RuleSet(version=1, defaults=Defaults(), routes=[], auth=None)
    with (
        patch("app.basic_auth.get_rules", return_value=rules_no_auth),
        patch.dict(os.environ, {}, clear=True),
    ):
        for key in ("BASIC_AUTH_USER", "BASIC_AUTH_PASSWORD"):
            os.environ.pop(key, None)
        users = _get_local_users()
    assert users == []
