import pytest
from fastapi.testclient import TestClient

from app.config import get_rules, set_rules
from app.main import app
from app.patterns import (
    get_pattern,
    init_patterns,
    list_patterns,
    save_pattern as save_pattern_data,
)
from app.rules import Defaults, MatchConfig, RouteConfig, RuleSet, TargetConfig, TransformConfig


def _base_rules() -> RuleSet:
    return RuleSet(
        version=1,
        defaults=Defaults(),
        routes=[
            RouteConfig(
                name="ocp-alertmanager",
                match=MatchConfig(source="ocp"),
                target=TargetConfig(url_env="TARGET_URL_OCP"),
                transform=TransformConfig(),
            )
        ],
    )


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        set_rules(_base_rules())
        init_patterns([])
        yield test_client
    set_rules(_base_rules())
    init_patterns([])


def _raise_permission_error(_: RuleSet) -> None:
    raise PermissionError("ConfigMap patch failed")


def test_save_pattern_returns_409_and_rolls_back_on_persist_failure(client, monkeypatch):
    monkeypatch.setattr("app.main.persist_rules", _raise_permission_error)

    response = client.post(
        "/api/patterns",
        json={
            "name": "p1",
            "source_type": "ocp-alertmanager-4.20",
            "mappings": [{"target_field_id": "title", "source_field_id": "groupLabels.alertname"}],
        },
    )

    assert response.status_code == 409
    assert list_patterns() == []


def test_delete_pattern_returns_409_and_restores_on_persist_failure(client, monkeypatch):
    saved = save_pattern_data(
        name="p2",
        source_type="ocp-alertmanager-4.20",
        mappings=[{"target_field_id": "title", "source_field_id": "groupLabels.alertname"}],
    )
    monkeypatch.setattr("app.main.persist_rules", _raise_permission_error)

    response = client.delete(f"/api/patterns/{saved['id']}")

    assert response.status_code == 409
    restored = get_pattern(saved["id"])
    assert restored is not None
    assert restored["name"] == "p2"


def test_apply_pattern_returns_409_and_keeps_rules_unchanged(client, monkeypatch):
    monkeypatch.setattr("app.main.persist_rules", _raise_permission_error)

    response = client.post(
        "/api/patterns/apply",
        json={
            "route_name": "ocp-alertmanager",
            "source_type": "ocp-alertmanager-4.20",
            "pattern_name": "temp-pattern",
            "mappings": [{"target_field_id": "title", "source_field_id": "groupLabels.alertname"}],
        },
    )

    assert response.status_code == 409
    assert list_patterns() == []

    rules = get_rules()
    route = next(r for r in rules.routes if r.name == "ocp-alertmanager")
    assert route.transform.include_fields is None
    assert route.transform.drop_fields is None
    assert route.transform.output_template is None
