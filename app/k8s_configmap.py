"""Update Kubernetes ConfigMap for persistent config storage (OCP)."""
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
    Persist rules.yaml into the ConfigMap (GET + replace).
    Returns True on success, False on failure.
    """
    try:
        from kubernetes import client, config
    except ImportError:
        logger.warning("kubernetes package not installed, cannot update ConfigMap")
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
        # kubernetes>=28: patch_namespaced_config_map no longer accepts _content_type;
        # default PATCH headers are ambiguous. read + replace (PUT) uses plain JSON and
        # matches RBAC verbs: get + update (see deploy Role for configmaps).
        v1 = client.CoreV1Api()
        cm = v1.read_namespaced_config_map(configmap_name, namespace)
        if cm.data is None:
            cm.data = {}
        cm.data["rules.yaml"] = rules_yaml
        v1.replace_namespaced_config_map(configmap_name, namespace, cm)
        logger.info("ConfigMap %s/%s updated successfully", namespace, configmap_name)
        return True, None
    except Exception as e:
        logger.warning(
            "Failed to update ConfigMap %s/%s: %s (%s)",
            namespace, configmap_name, type(e).__name__, e,
            exc_info=True,
        )
        return False, f"{type(e).__name__}: {e}"


def _load_k8s_client():
    """Load kubernetes client config (in-cluster first, then kubeconfig). Returns (CoreV1Api|None, error str|None)."""
    try:
        from kubernetes import client, config
    except ImportError:
        return None, "kubernetes package not installed"

    try:
        config.load_incluster_config()
    except Exception:
        try:
            config.load_kube_config()
        except Exception as e2:
            logger.warning(
                "Failed to load K8s config for ConfigMap read: %s; incluster_hint=%s",
                e2,
                _incluster_hint(),
            )
            return None, f"load K8s config: {e2}"

    return client.CoreV1Api(), None


def read_rules_yaml_from_configmap() -> Tuple[Optional[str], Optional[str]]:
    """
    Read rules.yaml from the configured ConfigMap via API (source of truth).
    Use this after persist to avoid stale mounted file reads on the same pod.
    Returns (yaml_text, error).
    """
    configmap_name = os.getenv("ALERTBRIDGE_CONFIGMAP_NAME", "").strip()
    if not configmap_name:
        return None, None

    v1, err = _load_k8s_client()
    if err or v1 is None:
        return None, err

    namespace = _get_namespace()
    try:
        cm = v1.read_namespaced_config_map(configmap_name, namespace)
        if not cm.data:
            return None, "ConfigMap has no data"
        raw = cm.data.get("rules.yaml")
        if raw is None or raw.strip() == "":
            return None, "ConfigMap missing rules.yaml key"
        return raw, None
    except Exception as e:
        logger.warning(
            "Failed to read ConfigMap %s/%s: %s (%s)",
            namespace,
            configmap_name,
            type(e).__name__,
            e,
            exc_info=True,
        )
        return None, f"{type(e).__name__}: {e}"


def persist_rules_to_configmap(rules_yaml: str) -> Tuple[bool, Optional[str]]:
    """
    Persist rules to ConfigMap when running in OCP.
    Requires ALERTBRIDGE_CONFIGMAP_NAME env.
    Returns True if updated, False if not applicable or failed.
    """
    configmap_name = os.getenv("ALERTBRIDGE_CONFIGMAP_NAME", "").strip()
    if not configmap_name:
        return False, None

    namespace = _get_namespace()
    return patch_configmap_rules(configmap_name, namespace, rules_yaml)
