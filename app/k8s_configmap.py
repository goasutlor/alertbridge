"""Patch Kubernetes ConfigMap for persistent config storage (OCP)."""
import logging
import os
from typing import Optional

logger = logging.getLogger("alertbridge")


def _load_incluster_config() -> bool:
    """Check if we're running inside a K8s cluster (in-cluster config available)."""
    return os.path.exists("/var/run/secrets/kubernetes.io/serviceaccount/namespace")


def _get_namespace() -> str:
    """Get current namespace from service account or env."""
    path = "/var/run/secrets/kubernetes.io/serviceaccount/namespace"
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return f.read().strip()
    return os.getenv("ALERTBRIDGE_NAMESPACE", "alertbridge")


def patch_configmap_rules(configmap_name: str, namespace: str, rules_yaml: str) -> bool:
    """
    Patch the ConfigMap with new rules.yaml content.
    Returns True on success, False on failure.
    """
    try:
        from kubernetes import client, config
    except ImportError:
        logger.warning("kubernetes package not installed, cannot patch ConfigMap")
        return False

    try:
        if _load_incluster_config():
            config.load_incluster_config()
        else:
            config.load_kube_config()
    except Exception as e:
        logger.warning("Failed to load K8s config: %s", e)
        return False

    try:
        v1 = client.CoreV1Api()
        body = {"data": {"rules.yaml": rules_yaml}}
        v1.patch_namespaced_config_map(configmap_name, namespace, body)
        logger.info("ConfigMap %s/%s patched successfully", namespace, configmap_name)
        return True
    except Exception as e:
        logger.warning("Failed to patch ConfigMap %s/%s: %s", namespace, configmap_name, e)
        return False


def persist_rules_to_configmap(rules_yaml: str) -> bool:
    """
    Persist rules to ConfigMap when running in OCP.
    Requires ALERTBRIDGE_CONFIGMAP_NAME env.
    Returns True if patched, False if not applicable or failed.
    """
    configmap_name = os.getenv("ALERTBRIDGE_CONFIGMAP_NAME", "").strip()
    if not configmap_name:
        return False

    namespace = _get_namespace()
    return patch_configmap_rules(configmap_name, namespace, rules_yaml)
