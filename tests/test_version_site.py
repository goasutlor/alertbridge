"""GET /version site label (CWDC vs TLS2) for portal header."""

from fastapi.testclient import TestClient

from app.main import app


def test_version_site_from_env_overrides_host(monkeypatch) -> None:
    monkeypatch.setenv("ALERTBRIDGE_SITE", "tls2")
    with TestClient(app) as c:
        r = c.get(
            "/version",
            headers={"Host": "alertbridge-lite.apps.cwdc.esb-kafka-prod.intra.ais"},
        )
    assert r.status_code == 200
    assert r.json().get("site") == "tls2"


def test_version_site_inferred_from_host_cwdc(monkeypatch) -> None:
    monkeypatch.delenv("ALERTBRIDGE_SITE", raising=False)
    with TestClient(app) as c:
        r = c.get(
            "/version",
            headers={"Host": "alertbridge-lite.apps.cwdc.esb-kafka-prod.intra.ais"},
        )
    assert r.status_code == 200
    assert r.json().get("site") == "cwdc"


def test_version_site_inferred_from_host_tls2(monkeypatch) -> None:
    monkeypatch.delenv("ALERTBRIDGE_SITE", raising=False)
    with TestClient(app) as c:
        r = c.get(
            "/version",
            headers={"Host": "alertbridge-lite.apps.tls2.esb-kafka-prod.intra.ais"},
        )
    assert r.status_code == 200
    assert r.json().get("site") == "tls2"


def test_version_site_none_when_unknown_host(monkeypatch) -> None:
    monkeypatch.delenv("ALERTBRIDGE_SITE", raising=False)
    with TestClient(app) as c:
        r = c.get("/version", headers={"Host": "localhost"})
    assert r.status_code == 200
    assert r.json().get("site") is None


def test_version_site_from_x_forwarded_host_when_host_absent(monkeypatch) -> None:
    monkeypatch.delenv("ALERTBRIDGE_SITE", raising=False)
    with TestClient(app) as c:
        r = c.get(
            "/version",
            headers={"X-Forwarded-Host": "alertbridge-lite.apps.tls2.esb-kafka-prod.intra.ais"},
        )
    assert r.status_code == 200
    assert r.json().get("site") == "tls2"
