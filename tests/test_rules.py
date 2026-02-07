from app.rules import (
    MatchConfig,
    OutputTemplate,
    RouteConfig,
    TargetConfig,
    TransformConfig,
    transform_payload,
)


def _route(transform: TransformConfig) -> RouteConfig:
    return RouteConfig(
        name="test",
        match=MatchConfig(source="test"),
        target=TargetConfig(url_env="TARGET_URL"),
        transform=transform,
    )


def test_include_and_drop_fields():
    payload = {
        "status": "firing",
        "labels": {"severity": "critical", "alertname": "DiskFull"},
        "annotations": {"summary": "Disk 95%", "runbook_url": "http://runbook"},
        "extra": {"ignore": True},
    }
    transform = TransformConfig(
        include_fields=["status", "labels", "annotations.summary"],
        drop_fields=["annotations.summary"],
    )
    result = transform_payload(payload, _route(transform))

    assert "extra" not in result
    assert "annotations" in result
    assert result["annotations"] == {}


def test_rename_and_enrich():
    payload = {"labels": {"severity": "warning", "alertname": "CPUHigh"}}
    transform = TransformConfig(
        rename={"labels.severity": "severity", "labels.alertname": "alert_name"},
        enrich_static={"env": "prod"},
    )
    result = transform_payload(payload, _route(transform))

    assert result["severity"] == "warning"
    assert result["alert_name"] == "CPUHigh"
    assert result["env"] == "prod"
    assert "labels" in result


def test_map_values_and_output_template():
    payload = {
        "severity": "critical",
        "annotations": {"summary": "Service down"},
    }
    transform = TransformConfig(
        map_values={"severity": {"critical": "P1", "warning": "P2"}},
        output_template=OutputTemplate(
            fields={
                "sev": "$.severity",
                "title": "$.annotations.summary",
                "missing": "$.not_exists",
            }
        ),
    )
    result = transform_payload(payload, _route(transform))

    assert result["sev"] == "P1"
    assert result["title"] == "Service down"
    assert result["missing"] is None
