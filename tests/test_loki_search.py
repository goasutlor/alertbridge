import pytest

from app.loki_search import build_logql


def test_build_logql_with_namespace_and_app(monkeypatch):
    monkeypatch.setenv("ALERTBRIDGE_K8S_NAMESPACE", "ns1")
    monkeypatch.setenv("ALERTBRIDGE_K8S_APP_LABEL", "myapp")
    q = build_logql("all", "abc123")
    assert '{namespace="ns1",container="myapp"}' in q
    assert ' |~ "abc123"' in q


def test_build_logql_errors_filter(monkeypatch):
    monkeypatch.setenv("ALERTBRIDGE_LOKI_STREAM_SELECTOR", '{app="x"}')
    q = build_logql("errors", "")
    assert '{app="x"}' in q
    assert ' |= "forward_failed"' in q


def test_build_logql_rejects_bad_event(monkeypatch):
    monkeypatch.setenv("ALERTBRIDGE_K8S_NAMESPACE", "ns1")
    monkeypatch.setenv("ALERTBRIDGE_K8S_APP_LABEL", "a")
    with pytest.raises(ValueError):
        build_logql("nope", "")


def test_build_logql_requires_selector(monkeypatch):
    monkeypatch.delenv("ALERTBRIDGE_LOKI_STREAM_SELECTOR", raising=False)
    monkeypatch.delenv("ALERTBRIDGE_K8S_NAMESPACE", raising=False)
    monkeypatch.delenv("ALERTBRIDGE_K8S_APP_LABEL", raising=False)
    with pytest.raises(ValueError):
        build_logql("all", "")
