import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import set_rules
from app.daily_metrics import increment_daily, read_daily
from app.main import app
from app.rules import Defaults, MatchConfig, RouteConfig, RuleSet, TargetConfig, TransformConfig


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


def test_daily_forward_fail_and_dlq_once_per_webhook_with_unroll(monkeypatch, tmp_path: Path) -> None:
    """Two unrolled alerts both fail → 2 DLQ lines but 1 daily forward_fail / dlq tick."""
    dlq = tmp_path / "failures.jsonl"
    mpath = tmp_path / "metrics" / "daily.json"
    monkeypatch.setenv("ALERTBRIDGE_DLQ_FILE", str(dlq))
    monkeypatch.setenv("ALERTBRIDGE_DAILY_METRICS_FILE", str(mpath))

    rules = RuleSet(
        version=1,
        defaults=Defaults(target_timeout_connect_sec=1, target_timeout_read_sec=1),
        routes=[
            RouteConfig(
                name="unroll-route",
                match=MatchConfig(source="probe"),
                target=TargetConfig(
                    url_env="UNUSED_UNROLL_METRICS",
                    url="http://127.0.0.1:9/",
                ),
                transform=TransformConfig(),
                unroll_alerts=True,
            )
        ],
    )

    async def fail_fast(*args, **kwargs):
        return (
            False,
            None,
            OSError("fast"),
            {"attempts_used": 1, "max_attempts": 4, "retried": False, "circuit_open": False},
        )

    monkeypatch.setattr("app.main.forward_payload", fail_fast)

    with TestClient(app) as ac:
        set_rules(rules)
        ac.post(
            "/webhook/probe",
            json={"alerts": [{"status": "firing", "labels": {}}, {"status": "firing", "labels": {}}]},
        )

    assert len([ln for ln in dlq.read_text(encoding="utf-8").splitlines() if ln.strip()]) == 2
    rows = read_daily(1)
    assert rows[0]["incoming"] == 1
    assert rows[0]["forward_fail"] == 1
    assert rows[0]["dlq"] == 1
    assert rows[0].get("forward_success", 0) == 0


def test_daily_forward_success_once_per_webhook_when_unroll_all_ok(monkeypatch, tmp_path: Path) -> None:
    """Two unrolled alerts both succeed → 2 RECENT_SENT-style outbounds but 1 daily forward_success (matches incoming)."""
    mpath = tmp_path / "metrics" / "daily.json"
    monkeypatch.setenv("ALERTBRIDGE_DAILY_METRICS_FILE", str(mpath))

    rules = RuleSet(
        version=1,
        defaults=Defaults(target_timeout_connect_sec=1, target_timeout_read_sec=1),
        routes=[
            RouteConfig(
                name="unroll-ok",
                match=MatchConfig(source="probe-ok"),
                target=TargetConfig(
                    url_env="UNUSED_UNROLL_OK",
                    url="http://127.0.0.1:9/",
                ),
                transform=TransformConfig(),
                unroll_alerts=True,
            )
        ],
    )

    async def ok_fast(*args, **kwargs):
        return (
            True,
            200,
            None,
            {"attempts_used": 1, "max_attempts": 4, "retried": False, "circuit_open": False},
        )

    monkeypatch.setattr("app.main.forward_payload", ok_fast)

    with TestClient(app) as ac:
        set_rules(rules)
        ac.post(
            "/webhook/probe-ok",
            json={"alerts": [{"status": "firing", "labels": {}}, {"status": "firing", "labels": {}}]},
        )

    rows = read_daily(1)
    assert rows[0]["incoming"] == 1
    assert rows[0]["forward_success"] == 1
    assert rows[0]["forward_fail"] == 0
    assert rows[0]["dlq"] == 0


def test_daily_no_incoming_on_route_not_found(monkeypatch, tmp_path: Path) -> None:
    """404 before route match must not increment daily incoming (keeps Incoming = Fwd OK + Fwd Fail)."""
    mpath = tmp_path / "metrics" / "daily.json"
    monkeypatch.setenv("ALERTBRIDGE_DAILY_METRICS_FILE", str(mpath))
    with TestClient(app) as ac:
        r = ac.post("/webhook/nonexistent-route-xyz", json={})
    assert r.status_code == 404
    rows = read_daily(30)
    assert not rows or rows[0].get("incoming", 0) == 0


def test_webhook_confluent_returns_410_without_counting_incoming(monkeypatch, tmp_path: Path) -> None:
    """Legacy /webhook/confluent is gone; must not count as incoming."""
    mpath = tmp_path / "metrics" / "daily.json"
    monkeypatch.setenv("ALERTBRIDGE_DAILY_METRICS_FILE", str(mpath))
    with TestClient(app) as ac:
        r = ac.post("/webhook/confluent", json={})
    assert r.status_code == 410
    rows = read_daily(30)
    assert not rows or rows[0].get("incoming", 0) == 0


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
