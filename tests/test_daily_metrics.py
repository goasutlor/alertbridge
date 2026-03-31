import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.daily_metrics import increment_daily, read_daily
from app.main import app


def test_daily_metrics_persist_counts(monkeypatch, tmp_path: Path) -> None:
    p = tmp_path / "metrics" / "daily.json"
    monkeypatch.setenv("ALERTBRIDGE_DAILY_METRICS_FILE", str(p))
    increment_daily("incoming")
    increment_daily("forward_success", amount=2)
    increment_daily("forward_fail")
    increment_daily("dlq")
    rows = read_daily(30)
    assert rows
    row = rows[0]
    assert row["incoming"] >= 1
    assert row["forward_success"] >= 2
    assert row["forward_fail"] >= 1
    assert row["dlq"] >= 1
    assert p.exists()
    # file should be json object keyed by day
    loaded = json.loads(p.read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)


def test_api_metrics_daily_returns_entries(monkeypatch, tmp_path: Path) -> None:
    p = tmp_path / "metrics" / "daily.json"
    monkeypatch.setenv("ALERTBRIDGE_DAILY_METRICS_FILE", str(p))
    increment_daily("incoming")
    with TestClient(app) as c:
        r = c.get("/api/metrics/daily?days=7")
    assert r.status_code == 200
    body = r.json()
    assert body["configured"] is True
    assert isinstance(body["entries"], list)
