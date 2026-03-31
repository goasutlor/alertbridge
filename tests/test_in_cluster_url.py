"""GET /api/in-cluster-webhook-base for Portal Client Info."""

from fastapi.testclient import TestClient

from app.main import app


def test_in_cluster_webhook_base_none_without_namespace(monkeypatch) -> None:
    monkeypatch.delenv("ALERTBRIDGE_K8S_NAMESPACE", raising=False)
    monkeypatch.delenv("ALERTBRIDGE_INTERNAL_WEBHOOK_BASE", raising=False)
    with TestClient(app) as c:
        r = c.get("/api/in-cluster-webhook-base")
    assert r.status_code == 200
    assert r.json().get("internal_webhook_base") is None


def test_in_cluster_webhook_base_from_namespace(monkeypatch) -> None:
    monkeypatch.delenv("ALERTBRIDGE_INTERNAL_WEBHOOK_BASE", raising=False)
    monkeypatch.setenv("ALERTBRIDGE_K8S_NAMESPACE", "alertbridge")
    with TestClient(app) as c:
        r = c.get("/api/in-cluster-webhook-base")
    assert r.status_code == 200
    assert r.json().get("internal_webhook_base") == "http://alertbridge-lite.alertbridge.svc.cluster.local"


def test_in_cluster_webhook_base_explicit_overrides(monkeypatch) -> None:
    monkeypatch.setenv("ALERTBRIDGE_INTERNAL_WEBHOOK_BASE", "http://custom.internal:8080")
    with TestClient(app) as c:
        r = c.get("/api/in-cluster-webhook-base")
    assert r.status_code == 200
    assert r.json().get("internal_webhook_base") == "http://custom.internal:8080"
