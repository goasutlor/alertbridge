import base64
import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import set_rules
from app.dlq import purge_dlq_all, purge_dlq_by_ids, read_recent_dlq
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
    assert row.get("final_failure") is True
    assert row.get("dlq_id")
    assert row.get("unroll_index") == 0
    assert row.get("unroll_count") == 1
    assert "base_request_id" in row
    assert "transformed" in row
    assert row.get("error") is not None
    assert "attempts_used" in row
    assert "max_attempts" in row
    assert "is_retry" in row
    assert "retry_count" in row
    assert "circuit_open" in row


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


def test_api_dlq_purge_all_requires_auth(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("ALERTBRIDGE_DLQ_FILE", str(tmp_path / "q.jsonl"))
    monkeypatch.setenv("BASIC_AUTH_USER", "u")
    monkeypatch.setenv("BASIC_AUTH_PASSWORD", "p")
    with TestClient(app) as ac:
        r = ac.post("/api/dlq/purge", json={"all": True})
    assert r.status_code == 401


def test_api_dlq_purge_all_ok(monkeypatch, tmp_path: Path) -> None:
    p = tmp_path / "q.jsonl"
    p.write_text(json.dumps({"a": 1}) + "\n", encoding="utf-8")
    monkeypatch.setenv("ALERTBRIDGE_DLQ_FILE", str(p))
    monkeypatch.setenv("BASIC_AUTH_USER", "u")
    monkeypatch.setenv("BASIC_AUTH_PASSWORD", "p")
    hdr = base64.b64encode(b"u:p").decode()
    with TestClient(app) as ac:
        r = ac.post("/api/dlq/purge", headers={"Authorization": f"Basic {hdr}"}, json={"all": True})
    assert r.status_code == 200
    assert r.json().get("ok") is True
    assert p.read_text(encoding="utf-8") == ""


def test_api_dlq_purge_by_ids(monkeypatch, tmp_path: Path) -> None:
    p = tmp_path / "q.jsonl"
    id_keep = "00000000-0000-0000-0000-000000000001"
    id_drop = "00000000-0000-0000-0000-000000000002"
    p.write_text(
        "\n".join(
            [
                json.dumps({"dlq_id": id_drop, "n": 1}),
                json.dumps({"dlq_id": id_keep, "n": 2}),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("ALERTBRIDGE_DLQ_FILE", str(p))
    monkeypatch.setenv("BASIC_AUTH_USER", "u")
    monkeypatch.setenv("BASIC_AUTH_PASSWORD", "p")
    hdr = base64.b64encode(b"u:p").decode()
    with TestClient(app) as ac:
        r = ac.post(
            "/api/dlq/purge",
            headers={"Authorization": f"Basic {hdr}"},
            json={"ids": [id_drop]},
        )
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is True
    assert body.get("removed") == 1
    lines = [ln for ln in p.read_text(encoding="utf-8").splitlines() if ln.strip()]
    assert len(lines) == 1
    assert json.loads(lines[0])["n"] == 2


def test_api_dlq_purge_by_request_id_legacy_row(monkeypatch, tmp_path: Path) -> None:
    """Rows without dlq_id are matched by request_id for purge."""
    p = tmp_path / "q.jsonl"
    rid_drop = "abc-uuid-0"
    rid_keep = "abc-uuid-1"
    p.write_text(
        "\n".join(
            [
                json.dumps({"request_id": rid_drop, "n": 1}),
                json.dumps({"request_id": rid_keep, "n": 2}),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("ALERTBRIDGE_DLQ_FILE", str(p))
    monkeypatch.setenv("BASIC_AUTH_USER", "u")
    monkeypatch.setenv("BASIC_AUTH_PASSWORD", "p")
    hdr = base64.b64encode(b"u:p").decode()
    with TestClient(app) as ac:
        r = ac.post(
            "/api/dlq/purge",
            headers={"Authorization": f"Basic {hdr}"},
            json={"ids": [rid_drop]},
        )
    assert r.status_code == 200
    assert r.json().get("removed") == 1
    lines = [ln for ln in p.read_text(encoding="utf-8").splitlines() if ln.strip()]
    assert len(lines) == 1
    assert json.loads(lines[0])["n"] == 2


def test_purge_dlq_by_ids_helpers(monkeypatch, tmp_path: Path) -> None:
    p = tmp_path / "q.jsonl"
    monkeypatch.setenv("ALERTBRIDGE_DLQ_FILE", str(p))
    p.write_text(json.dumps({"dlq_id": "x"}) + "\n" + json.dumps({"dlq_id": "y"}) + "\n", encoding="utf-8")
    n, err = purge_dlq_by_ids({"x"})
    assert err is None
    assert n == 1
    rest = p.read_text(encoding="utf-8").strip()
    assert "y" in rest and "x" not in rest
    ok, err2 = purge_dlq_all()
    assert ok and err2 is None
    assert p.read_text(encoding="utf-8") == ""


def test_webhook_forward_paused_skips_outbound_but_records_failed_and_dlq(monkeypatch, tmp_path: Path) -> None:
    dlq = tmp_path / "paused.jsonl"
    monkeypatch.setenv("ALERTBRIDGE_DLQ_FILE", str(dlq))

    async def should_not_call(*args, **kwargs):
        raise AssertionError("forward_payload must not be called when forward_enabled is false")

    monkeypatch.setattr("app.main.forward_payload", should_not_call)

    rules = RuleSet(
        version=1,
        defaults=Defaults(target_timeout_connect_sec=1, target_timeout_read_sec=1),
        routes=[
            RouteConfig(
                name="trivial",
                match=MatchConfig(source="probe"),
                target=TargetConfig(
                    url_env="UNUSED_PAUSE_TEST",
                    url="http://127.0.0.1:9/",
                ),
                transform=TransformConfig(),
                forward_enabled=False,
            )
        ],
    )

    with TestClient(app) as ac:
        set_rules(rules)
        r = ac.post("/webhook/probe", json={"alerts": [{"status": "firing", "labels": {}}]})
        failed = ac.get("/api/recent-failed")

    assert r.status_code == 200
    body = r.json()
    assert body.get("forward_paused") is True
    assert body.get("forwarded") is False
    assert dlq.exists()
    lines = dlq.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1
    row = json.loads(lines[0])
    assert row.get("forward_paused") is True
    assert row.get("error_type") == "ForwardPaused"
    assert failed.status_code == 200
    failed_list = failed.json()
    assert any(
        x.get("error") == "Forwarding paused (outbound disabled for this route)" for x in failed_list
    ), failed_list


def test_webhook_forward_paused_unroll_one_dlq_row_per_shard(monkeypatch, tmp_path: Path) -> None:
    """Paused + unroll_alerts: each shard gets its own DLQ line and alert_bundle for that alert only."""
    dlq = tmp_path / "paused_unroll.jsonl"
    monkeypatch.setenv("ALERTBRIDGE_DLQ_FILE", str(dlq))

    async def should_not_call(*args, **kwargs):
        raise AssertionError("forward_payload must not be called when forward_enabled is false")

    monkeypatch.setattr("app.main.forward_payload", should_not_call)

    rules = RuleSet(
        version=1,
        defaults=Defaults(target_timeout_connect_sec=1, target_timeout_read_sec=1),
        routes=[
            RouteConfig(
                name="unroll-pause",
                match=MatchConfig(source="probe"),
                target=TargetConfig(
                    url_env="UNUSED_PAUSE_UNROLL",
                    url="http://127.0.0.1:9/",
                ),
                transform=TransformConfig(),
                forward_enabled=False,
                unroll_alerts=True,
            )
        ],
    )
    body = {
        "alerts": [
            {"status": "firing", "labels": {"alertname": "Alpha"}},
            {"status": "resolved", "labels": {"alertname": "Beta"}},
        ]
    }
    with TestClient(app) as ac:
        set_rules(rules)
        r = ac.post("/webhook/probe", json=body)

    assert r.status_code == 200
    assert dlq.exists()
    lines = [ln for ln in dlq.read_text(encoding="utf-8").splitlines() if ln.strip()]
    assert len(lines) == 2
    row0 = json.loads(lines[0])
    row1 = json.loads(lines[1])
    assert row0["unroll_index"] == 0 and row0["unroll_count"] == 2
    assert row1["unroll_index"] == 1 and row1["unroll_count"] == 2
    assert str(row0["request_id"]).endswith("-0")
    assert str(row1["request_id"]).endswith("-1")
    assert "Alpha" in (row0.get("alert_bundle_preview") or "")
    assert "Beta" not in (row0.get("alert_bundle_preview") or "")
    assert "Beta" in (row1.get("alert_bundle_preview") or "")
    assert "Alpha" not in (row1.get("alert_bundle_preview") or "")
