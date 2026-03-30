"""Patch Kubernetes ConfigMap for persistent config storage (OCP)."""
import logging
import os
from typing import Optional, Tuple

logger = logging.getLogger("alertbridge")


def _incluster_hint() -> bool:
    """Best-effort hint that we are in-cluster (not required for loading)."""
    return (
        os.path.exists("/var/run/secrets/kubernetes.io/serviceaccount/token")
        or "KUBERNETES_SERVICE_HOST" in os.environ
    )


def _get_namespace() -> str:
    """Get current namespace from service account or env."""
    path = "/var/run/secrets/kubernetes.io/serviceaccount/namespace"
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return f.read().strip()
    return os.getenv("ALERTBRIDGE_NAMESPACE", "alertbridge")


def patch_configmap_rules(configmap_name: str, namespace: str, rules_yaml: str) -> Tuple[bool, Optional[str]]:
    """
    Patch the ConfigMap with new rules.yaml content.
    Returns True on success, False on failure.
    """
    try:
        from kubernetes import client, config
    except ImportError:
        logger.warning("kubernetes package not installed, cannot patch ConfigMap")
        return False, "kubernetes package not installed"

    # Try in-cluster first (typical in OCP/K8s). Fallback to local kubeconfig for dev tools.
    # Do not rely only on filesystem markers; some hardened runtimes can differ.
    incluster_err: Optional[Exception] = None
    kubeconfig_err: Optional[Exception] = None
    try:
        config.load_incluster_config()
    except Exception as e:
        incluster_err = e
        try:
            config.load_kube_config()
        except Exception as e2:
            kubeconfig_err = e2
            logger.warning(
                "Failed to load K8s config (in-cluster then kubeconfig). "
                "in-cluster=%s; kubeconfig=%s; incluster_hint=%s",
                incluster_err,
                kubeconfig_err,
                _incluster_hint(),
            )
            return False, (
                "load K8s config: "
                f"in-cluster={incluster_err}; kubeconfig={kubeconfig_err}"
            )

    try:
        v1 = client.CoreV1Api()
        body = {"data": {"rules.yaml": rules_yaml}}
        v1.patch_namespaced_config_map(
            configmap_name, namespace, body,
            _content_type="application/merge-patch+json",
        )
        logger.info("ConfigMap %s/%s patched successfully", namespace, configmap_name)
        return True, None
    except Exception as e:
        logger.warning(
            "Failed to patch ConfigMap %s/%s: %s (%s)",
            namespace, configmap_name, type(e).__name__, e,
            exc_info=True,
        )
        return False, f"{type(e).__name__}: {e}"


def persist_rules_to_configmap(rules_yaml: str) -> Tuple[bool, Optional[str]]:
    """
    Persist rules to ConfigMap when running in OCP.
    Requires ALERTBRIDGE_CONFIGMAP_NAME env.
    Returns True if patched, False if not applicable or failed.
    """
    configmap_name = os.getenv("ALERTBRIDGE_CONFIGMAP_NAME", "").strip()
    if not configmap_name:
        return False, None

    namespace = _get_namespace()
    return patch_configmap_rules(configmap_name, namespace, rules_yaml)
