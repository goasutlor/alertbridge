"""Alert summary / severity extraction from webhook payloads."""
from app.main import (
    extract_alert_severity,
    extract_bundle_alert_names,
    extract_bundle_firing_status,
    extract_shard_firing_status,
    format_alert_bundle_for_ui,
)


def test_extract_severity_common_labels():
    p = {"commonLabels": {"severity": "warning", "alertname": "Foo"}}
    assert extract_alert_severity(p) == "warning"


def test_extract_severity_prefers_worst_per_alert_over_common_labels():
    """Alertmanager groups may set commonLabels.severity while individual alerts differ."""
    p = {
        "commonLabels": {"severity": "warning"},
        "alerts": [
            {"labels": {"severity": "warning", "alertname": "A"}},
            {"labels": {"severity": "critical", "alertname": "B"}},
        ],
    }
    assert extract_alert_severity(p) == "critical"


def test_extract_severity_alerts_array():
    p = {"alerts": [{"labels": {"severity": "critical", "alertname": "Bar"}}]}
    assert extract_alert_severity(p) == "critical"


def test_extract_severity_confluent_flat():
    p = {"severity": "info", "alertId": "x"}
    assert extract_alert_severity(p) == "info"


def test_extract_severity_top_labels():
    p = {"labels": {"severity": "none"}}
    assert extract_alert_severity(p) == "none"


def test_extract_severity_empty():
    assert extract_alert_severity({}) == ""
    assert extract_alert_severity(None) == ""


def test_extract_bundle_firing_all_firing():
    p = {"alerts": [{"status": "firing"}, {"status": "firing"}]}
    assert extract_bundle_firing_status(p) == "firing"


def test_extract_bundle_firing_mixed():
    p = {"alerts": [{"status": "firing"}, {"status": "resolved"}]}
    assert extract_bundle_firing_status(p) == "mixed"


def test_extract_bundle_firing_top_level():
    p = {"status": "resolved", "alerts": []}
    assert extract_bundle_firing_status(p) == "resolved"


def test_extract_shard_firing():
    san = {"alerts": [{"status": "resolved", "labels": {}}]}
    assert extract_shard_firing_status(san) == "resolved"


def test_extract_bundle_alert_names_ordered():
    p = {
        "alerts": [
            {"labels": {"alertname": "A"}},
            {"labels": {"alertname": "B"}},
        ]
    }
    assert extract_bundle_alert_names(p) == ["A", "B"]


def test_extract_bundle_alert_names_annotation_fallback():
    p = {"alerts": [{"annotations": {"summary": "S1"}}]}
    assert extract_bundle_alert_names(p) == ["S1"]


def test_format_alert_bundle_for_ui_multiline_detail():
    p = {"alerts": [{"labels": {"alertname": "X"}}, {"labels": {"alertname": "Y"}}]}
    prev, det = format_alert_bundle_for_ui(p)
    assert "[0] X" in prev and "[1] Y" in prev
    assert det == "[0] X\n[1] Y"


def test_format_alert_bundle_for_ui_many_alerts_preview_truncates():
    alerts = [{"labels": {"alertname": f"N{i}"}} for i in range(8)]
    prev, det = format_alert_bundle_for_ui({"alerts": alerts})
    assert "(+2 more)" in prev
    assert det.count("\n") == 7


def test_format_alert_bundle_for_ui_no_alerts_uses_flat_summary():
    p = {"labels": {"alertname": "FlatOnly"}}
    prev, det = format_alert_bundle_for_ui(p)
    assert "FlatOnly" in prev
    assert det == "FlatOnly"
