import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import set_rules
from app.main import app
from app.rules import Defaults, MatchConfig, RouteConfig, RuleSet, TargetConfig, TransformConfig


def test_success_log_persists_and_recent_sent_reads_from_file(monkeypatch, tmp_path: Path) -> None:
    success_file = tmp_path / "success.jsonl"
    monkeypatch.setenv("ALERTBRIDGE_SUCCESS_LOG_ENABLED", "true")
    monkeypatch.setenv("ALERTBRIDGE_SUCCESS_LOG_FILE", str(success_file))

    async def fake_forward(*args, **kwargs):
        return True, 200, None, {"attempts_used": 1, "max_attempts": 1, "retried": False, "circuit_open": False}

    monkeypatch.setattr("app.main.forward_payload", fake_forward)

    rules = RuleSet(
        version=1,
        defaults=Defaults(target_timeout_connect_sec=1, target_timeout_read_sec=1),
        routes=[
            RouteConfig(
                name="ok-route",
                match=MatchConfig(source="probe"),
                target=TargetConfig(url_env="UNUSED_SUCCESS_TEST", url="http://127.0.0.1:9/"),
                transform=TransformConfig(),
                unroll_alerts=True,
            )
        ],
    )
    payload = {
        "alerts": [
            {"status": "firing", "labels": {"alertname": "A", "severity": "warning"}},
            {"status": "resolved", "labels": {"alertname": "B", "severity": "warning"}},
        ]
    }
    with TestClient(app) as ac:
        set_rules(rules)
        r = ac.post("/webhook/probe", json=payload)
        recent = ac.get("/api/recent-sent")

    assert r.status_code == 200
    assert success_file.exists()
    lines = [ln for ln in success_file.read_text(encoding="utf-8").splitlines() if ln.strip()]
    assert len(lines) == 2
    row0 = json.loads(lines[0])
    row1 = json.loads(lines[1])
    assert str(row0.get("request_id", "")).endswith("-0")
    assert str(row1.get("request_id", "")).endswith("-1")
    assert recent.status_code == 200
    arr = recent.json()
    assert isinstance(arr, list) and len(arr) >= 2
    ids = [str(x.get("request_id") or "") for x in arr]
    assert any(i.endswith("-0") for i in ids)
    assert any(i.endswith("-1") for i in ids)
