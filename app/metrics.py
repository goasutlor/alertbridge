from prometheus_client import Counter, Histogram

REQUESTS_TOTAL = Counter(
    "alertbridge_requests_total",
    "Total webhook requests",
    ["source", "route", "status"],
)

FORWARD_TOTAL = Counter(
    "alertbridge_forward_total",
    "Total forward attempts",
    ["route", "result"],
)

FORWARD_LATENCY_SECONDS = Histogram(
    "alertbridge_forward_latency_seconds",
    "Forward latency in seconds",
    ["route"],
)

CONFIG_RELOAD_TOTAL = Counter(
    "alertbridge_config_reload_total",
    "Config reload/save attempts",
    ["result"],
)

HMAC_VERIFY_TOTAL = Counter(
    "alertbridge_hmac_verify_total",
    "HMAC signature verification attempts",
    ["route", "result"],
)


def get_request_stats() -> dict:
    """Return current request/forward counts for UI (from Prometheus counters)."""
    total_requests = 0
    by_source: dict[str, int] = {}
    by_status: dict[str, int] = {}
    forward_ok = 0
    forward_fail = 0
    for labels, metric in REQUESTS_TOTAL._metrics.items():
        val = int(metric._value.get())
        total_requests += val
        # labels is (source, route, status) for REQUESTS_TOTAL
        if len(labels) >= 3:
            src = labels[0] or ""
            by_source[src] = by_source.get(src, 0) + val
            st = labels[2] or ""
            by_status[st] = by_status.get(st, 0) + val
    for labels, metric in FORWARD_TOTAL._metrics.items():
        val = int(metric._value.get())
        if len(labels) >= 2 and labels[1] == "success":
            forward_ok += val
        else:
            forward_fail += val
    return {
        "total_requests": total_requests,
        "by_source": by_source,
        "by_status": by_status,
        "forward_success": forward_ok,
        "forward_fail": forward_fail,
    }
