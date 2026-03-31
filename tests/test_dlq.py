import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import set_rules
from app.main import app
from app.rules import Defaults, MatchConfig, RouteConfig, RuleSet, TargetConfig, TransformConfig


def test_dlq_appends_line_on_forward_failure(monkeypatch, tmp_path: Path) -> None:
    dlq = tmp_path / "failures.jsonl"
    monkeypatch.setenv("ALERTBRIDGE_DLQ_FILE", str(dlq))

    rules = RuleSet(
        version=1,
        defaults=Defaults(
            target_timeout_connect_sec=1,
            target_timeout_read_sec=1,
        ),
        routes=[
            RouteConfig(
                name="trivial",
                match=MatchConfig(source="probe"),
                target=TargetConfig(
                    url_env="UNUSED_DLQ_TEST",
                    url="http://127.0.0.1:9/",
                ),
                transform=TransformConfig(),
            )
        ],
    )

    with TestClient(app) as ac:
        set_rules(rules)
        ac.post(
            "/webhook/probe",
            json={"alerts": [{"status": "firing", "labels": {}}]},
        )

    assert dlq.exists()
    lines = dlq.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) >= 1
    row = json.loads(lines[-1])
    assert row["route"] == "trivial"
    assert row["source"] == "probe"
    assert "transformed" in row
    assert row.get("error") is not None
