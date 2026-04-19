from app.rules import (
    ConcatTemplateSpec,
    MatchConfig,
    OutputTemplate,
    RouteConfig,
    TargetConfig,
    TransformConfig,
    transform_payload,
)


def test_load_rules_from_yaml_text_restores_patterns():
    from app.config import load_rules_from_yaml_text
    from app.patterns import list_patterns

    yaml_text = """
version: 1
defaults:
  target_timeout_connect_sec: 2
  target_timeout_read_sec: 5
routes: []
patterns:
  - id: test-pattern-id
    name: MyPattern
    source_type: ocp-alertmanager-4.20
    mappings: []
"""
    load_rules_from_yaml_text(yaml_text)
    names = [p["name"] for p in list_patterns()]
    assert "MyPattern" in names


def test_load_rules_keeps_only_ocp_routes():
    """Stored YAML may list extra routes; only match.source ocp is kept."""
    from app.config import load_rules_from_yaml_text

    yaml_text = """
version: 1
defaults:
  target_timeout_connect_sec: 2
  target_timeout_read_sec: 5
routes:
  - name: ocp-alertmanager
    match:
      source: ocp
    target:
      url_env: TARGET_URL_OCP
    transform: {}
  - name: legacy-other
    match:
      source: legacy
    target:
      url_env: TARGET_URL_LEGACY
    transform: {}
"""
    rules = load_rules_from_yaml_text(yaml_text)
    assert len(rules.routes) == 1
    assert rules.routes[0].match.source == "ocp"


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


def test_concat_templates_combine_fields():
    payload = {
        "status": "firing",
        "alerts": [
            {
                "status": "resolved",
                "annotations": {
                    "description": "Memory major pages are occurring at very high rate.",
                },
            }
        ],
    }
    transform = TransformConfig(
        concat_templates={
            "message": ConcatTemplateSpec(
                template="[{0}] {1}",
                paths=["alerts.0.status", "alerts.0.annotations.description"],
            ),
        },
        output_template=OutputTemplate(
            fields={
                "message": "$.message",
            }
        ),
    )
    result = transform_payload(payload, _route(transform))
    assert result["message"] == "[resolved] Memory major pages are occurring at very high rate."


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


def test_alerts_array_path_mapping():
    """Paths like alerts.0.labels.job and alerts.0.startsAt must resolve correctly."""
    payload = {
        "groupLabels": {"alertname": "MyAlert", "job": "prometheus"},
        "commonLabels": {
            "severity": "critical",
            "instance": "kafka",
            "pod": "kafka-01",
        },
        "commonAnnotations": {"description": "This is a book"},
        "alerts": [
            {
                "labels": {"job": "prometheus", "alertname": "MyAlert"},
                "annotations": {"description": "This is a book"},
                "startsAt": "2026-02-07T12:16:06.689Z",
            }
        ],
    }
    transform = TransformConfig(
        include_fields=[
            "groupLabels",
            "commonLabels",
            "commonAnnotations",
            "alerts",
            "alerts.0",
            "alerts.0.labels",
            "alerts.0.labels.job",
            "alerts.0.startsAt",
        ],
        rename={
            "commonLabels.severity": "severity",
            "groupLabels.alertname": "title",
            "commonAnnotations.description": "message",
            "commonLabels.instance": "env",
            "commonLabels.pod": "site",
            "alerts.0.labels.job": "source_id",
            "alerts.0.startsAt": "timestamp",
        },
        output_template=OutputTemplate(
            type="flat",
            fields={
                "severity": "$.severity",
                "title": "$.title",
                "message": "$.message",
                "env": "$.env",
                "site": "$.site",
                "source_id": "$.source_id",
                "timestamp": "$.timestamp",
            },
        ),
    )
    result = transform_payload(payload, _route(transform))

    assert result["severity"] == "critical"
    assert result["title"] == "MyAlert"
    assert result["message"] == "This is a book"
    assert result["env"] == "kafka"
    assert result["site"] == "kafka-01"
    assert result["source_id"] == "prometheus"
    assert result["timestamp"] == "2026-02-07T12:16:06.689Z"


def test_alert_details_as_array_not_object():
    """Paths like data.alert_details.0.meta must produce array, not object with '0' key."""
    payload = {"commonLabels": {"severity": "critical", "pod": "x"}, "groupLabels": {"alertname": "Test"}}
    transform = TransformConfig(
        rename={
            "commonLabels": "data.alert_details.0.meta",
            "groupLabels.alertname": "data.alert_details.0.meta.event",
        },
        output_template=OutputTemplate(
            fields={
                "data.alert_details.0.meta": "$.data.alert_details.0.meta",
                "data.alert_details.0.meta.event": "$.data.alert_details.0.meta.event",
            }
        ),
    )
    result = transform_payload(payload, _route(transform))
    # Must be array [{}], not object {"0": {}}
    assert isinstance(result.get("data", {}).get("alert_details"), list)
    assert result["data"]["alert_details"][0]["meta"]["severity"] == "critical"
    assert result["data"]["alert_details"][0]["meta"]["event"] == "Test"


def test_nested_output_template():
    """Output with nested target paths (labels.*, annotations.*) preserves structure."""
    payload = {
        "groupLabels": {"alertname": "TargetDown"},
        "commonLabels": {
            "severity": "critical",
            "namespace": "openshift-monitoring",
            "pod": "prometheus-k8s-0",
        },
        "commonAnnotations": {"summary": "Target is down", "description": "Description of the alert"},
        "alerts": [{"startsAt": "2026-02-06T15:00:00Z", "generatorURL": "http://prometheus:9090/..."}],
    }
    transform = TransformConfig(
        include_fields=["groupLabels", "commonLabels", "commonAnnotations", "alerts", "alerts.0"],
        rename={
            "groupLabels.alertname": "labels.alertname",
            "commonLabels.severity": "labels.severity",
            "commonLabels.namespace": "labels.namespace",
            "commonLabels.pod": "labels.pod",
            "commonAnnotations.summary": "annotations.summary",
            "commonAnnotations.description": "annotations.description",
            "alerts.0.startsAt": "startsAt",
            "alerts.0.generatorURL": "generatorURL",
        },
        enrich_static={"status": "firing"},
        output_template=OutputTemplate(
            type="flat",
            fields={
                "status": "$.status",
                "labels.alertname": "$.labels.alertname",
                "labels.severity": "$.labels.severity",
                "labels.namespace": "$.labels.namespace",
                "labels.pod": "$.labels.pod",
                "annotations.summary": "$.annotations.summary",
                "annotations.description": "$.annotations.description",
                "startsAt": "$.startsAt",
                "generatorURL": "$.generatorURL",
            },
        ),
    )
    result = transform_payload(payload, _route(transform))

    assert result == {
        "status": "firing",
        "labels": {
            "alertname": "TargetDown",
            "severity": "critical",
            "namespace": "openshift-monitoring",
            "pod": "prometheus-k8s-0",
        },
        "annotations": {
            "summary": "Target is down",
            "description": "Description of the alert",
        },
        "startsAt": "2026-02-06T15:00:00Z",
        "generatorURL": "http://prometheus:9090/...",
    }


def test_coalesce_sources_skips_empty_string_for_next_path():
    """First path with a non-empty value wins; empty string falls through to next path."""
    payload = {
        "alerts": [{"labels": {"severity": ""}}],
        "commonLabels": {"severity": "warning"},
    }
    transform = TransformConfig(
        include_fields=["alerts", "alerts.0", "alerts.0.labels", "commonLabels"],
        coalesce_sources={"severity": ["alerts.0.labels.severity", "commonLabels.severity"]},
        output_template=OutputTemplate(
            type="flat",
            fields={"severity": "$.severity"},
        ),
    )
    result = transform_payload(payload, _route(transform))
    assert result["severity"] == "warning"


def test_coalesce_sources_first_non_empty_wins():
    payload = {
        "alerts": [{"labels": {"severity": "critical"}}],
        "commonLabels": {"severity": "warning"},
    }
    transform = TransformConfig(
        include_fields=["alerts", "alerts.0", "alerts.0.labels", "commonLabels"],
        coalesce_sources={"severity": ["alerts.0.labels.severity", "commonLabels.severity"]},
        output_template=OutputTemplate(
            type="flat",
            fields={"severity": "$.severity"},
        ),
    )
    result = transform_payload(payload, _route(transform))
    assert result["severity"] == "critical"


def test_build_transform_source_field_ids():
    from app.patterns import build_transform_from_mapping

    cfg = build_transform_from_mapping(
        [
            {
                "target_field_id": "alarmName",
                "source_field_ids": ["groupLabels.alertname", "commonLabels.alertname", "alerts.0.labels.alertname"],
            }
        ]
    )
    assert cfg.coalesce_sources == {
        "alarmName": ["groupLabels.alertname", "commonLabels.alertname", "alerts.0.labels.alertname"]
    }
    assert "groupLabels.alertname" in (cfg.include_fields or [])


def test_build_transform_concat_template():
    from app.patterns import build_transform_from_mapping

    cfg = build_transform_from_mapping(
        [
            {
                "target_field_id": "annotations.description",
                "concat_template": "[{0}] {1}",
                "concat_paths": ["alerts.0.status", "alerts.0.annotations.description"],
            }
        ],
        target_field_ids=["annotations.description"],
    )
    assert cfg.concat_templates is not None
    assert "annotations.description" in cfg.concat_templates
    spec = cfg.concat_templates["annotations.description"]
    assert spec.template == "[{0}] {1}"
    assert spec.paths == ["alerts.0.status", "alerts.0.annotations.description"]
