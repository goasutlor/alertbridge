"""Alert summary / severity extraction from webhook payloads."""
from app.main import extract_alert_severity, extract_bundle_firing_status, extract_shard_firing_status


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
