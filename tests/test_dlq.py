import base64
import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import set_rules
from app.dlq import read_recent_dlq
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


def test_read_recent_dlq_newest_first(monkeypatch, tmp_path: Path) -> None:
    dlq = tmp_path / "queue.jsonl"
    monkeypatch.setenv("ALERTBRIDGE_DLQ_FILE", str(dlq))
    dlq.write_text(
        "\n".join([json.dumps({"n": 1}), json.dumps({"n": 2}), json.dumps({"n": 3})]) + "\n",
        encoding="utf-8",
    )
    rows = read_recent_dlq(limit=2)
    assert len(rows) == 2
    assert rows[0]["n"] == 3
    assert rows[1]["n"] == 2


def test_api_dlq_recent_requires_auth_when_basic_enabled(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("ALERTBRIDGE_DLQ_FILE", str(tmp_path / "x.jsonl"))
    monkeypatch.setenv("BASIC_AUTH_USER", "u")
    monkeypatch.setenv("BASIC_AUTH_PASSWORD", "p")
    with TestClient(app) as ac:
        r = ac.get("/api/dlq/recent")
    assert r.status_code == 401


def test_api_dlq_recent_ok_with_auth(monkeypatch, tmp_path: Path) -> None:
    p = tmp_path / "x.jsonl"
    monkeypatch.setenv("ALERTBRIDGE_DLQ_FILE", str(p))
    monkeypatch.setenv("BASIC_AUTH_USER", "u")
    monkeypatch.setenv("BASIC_AUTH_PASSWORD", "p")
    p.write_text(json.dumps({"route": "x", "source": "y"}) + "\n", encoding="utf-8")
    hdr = base64.b64encode(b"u:p").decode()
    with TestClient(app) as ac:
        r = ac.get("/api/dlq/recent", headers={"Authorization": f"Basic {hdr}"})
    assert r.status_code == 200
    body = r.json()
    assert body["configured"] is True
    assert body["count"] == 1


def test_api_dlq_recent_503_when_unconfigured(monkeypatch) -> None:
    monkeypatch.delenv("ALERTBRIDGE_DLQ_FILE", raising=False)
    with TestClient(app) as ac:
        r = ac.get("/api/dlq/recent")
    assert r.status_code == 503
    assert r.json().get("configured") is False
