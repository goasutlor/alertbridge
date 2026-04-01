import asyncio
import copy
import json
import logging
import os
import time
import uuid
from collections import deque
from datetime import datetime, timedelta, timezone

# Bangkok (GMT+7) for all displayed timestamps
BANGKOK = timezone(timedelta(hours=7))
from pathlib import Path
from typing import Any, Dict, Optional

import yaml
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from app.config import (
    CONFIG_WATCH_INTERVAL,
    get_rules,
    persist_rules,
    reload_rules,
    rules_loaded,
    set_rules,
    watch_and_reload,
)
from app.daily_metrics import daily_metrics_file_path, increment_daily, read_daily
from app.dlq import dlq_file_path, purge_dlq_all, purge_dlq_by_ids, read_recent_dlq, record_failed_forward
from app.forwarder import check_target_status, close_client, forward_payload, get_client
from app.logging_conf import configure_logging
from app.hmac_verify import verify_hmac as verify_hmac_signature
from app.metrics import (
    CONFIG_RELOAD_TOTAL,
    FORWARD_LATENCY_SECONDS,
    FORWARD_TOTAL,
    HMAC_VERIFY_TOTAL,
    REQUESTS_TOTAL,
    get_request_stats,
)
from app.basic_auth import require_basic_auth
from app.api_key import (
    create_api_key,
    get_api_keys,
    verify_api_key,
)
from app.patterns import (
    build_transform_from_mapping,
    get_pattern,
    list_patterns,
    list_schemas,
    save_pattern as save_pattern_data,
    delete_pattern as delete_pattern_data,
)
from app.rules import ApiKeyConfig, Defaults, RuleSet, sanitize_payload, select_route, transform_payload


configure_logging()
logger = logging.getLogger("alertbridge")
APP_VERSION = os.getenv("APP_VERSION", "1.0.08022026")
app = FastAPI(
    title="AlertBridge",
    version=APP_VERSION,
    description="Stateless webhook relay and transformer. Author: Sontas Jiamsripong",
)

BASE_DIR = Path(__file__).resolve().parent
TEMPLATE_FILE = BASE_DIR / "templates" / "index.html"

# Request body size limits (DoS mitigation)
MAX_WEBHOOK_BODY_BYTES = 1 * 1024 * 1024   # 1 MiB
MAX_CONFIG_BODY_BYTES = 512 * 1024         # 512 KiB

# In-memory recent webhook events for UI live feed (newest last in deque)
RECENT_WEBHOOKS: deque = deque(maxlen=20)
# Recent incoming payloads (sanitized) so UI can "Use as source pattern" from real traffic
RECENT_PAYLOADS: deque = deque(maxlen=30)
# Failed forward events (limited, stateless - lost on restart)
RECENT_FAILED: deque = deque(maxlen=200)
# Successfully forwarded (transformed) payloads - only last event for UI
RECENT_SENT: deque = deque(maxlen=1)

app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


def extract_alert_summary(payload: Any) -> str:
    """Extract alert name/summary from OCP Alertmanager or Confluent payload."""
    if not payload or not isinstance(payload, dict):
        return ""
    # Confluent: description, alertId, severity
    for k in ("description", "alertId", "severity"):
        v = payload.get(k)
        if v and isinstance(v, str):
            return v[:100]
    # OCP Alertmanager: alerts[0].labels.alertname, annotations.summary, annotations.description
    alerts = payload.get("alerts")
    if isinstance(alerts, list) and alerts and isinstance(alerts[0], dict):
        a = alerts[0]
        labels = (a.get("labels") or {})
        ann = (a.get("annotations") or {})
        for key in ("alertname", "summary", "description"):
            v = labels.get(key) or ann.get(key)
            if v and isinstance(v, str):
                return v[:100]
    # Single alert (no alerts array)
    labels = payload.get("labels") or {}
    ann = payload.get("annotations") or {}
    for key in ("alertname", "summary", "description"):
        v = labels.get(key) or ann.get(key)
        if v and isinstance(v, str):
            return v[:100]
    return ""


_config_watch_task: Optional[asyncio.Task] = None


async def _config_watch_loop() -> None:
    """Background task: poll rules file mtime and auto-reload when changed."""
    while CONFIG_WATCH_INTERVAL > 0:
        await asyncio.sleep(CONFIG_WATCH_INTERVAL)
        try:
            watch_and_reload()
        except Exception as exc:
            logger.warning("Config watch loop error: %s", exc)


@app.on_event("startup")
async def startup() -> None:
    global _config_watch_task
    get_client()
    reload_rules()
    if CONFIG_WATCH_INTERVAL > 0:
        _config_watch_task = asyncio.create_task(_config_watch_loop())


@app.on_event("shutdown")
async def shutdown() -> None:
    global _config_watch_task
    if _config_watch_task and not _config_watch_task.done():
        _config_watch_task.cancel()
    await close_client()


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next) -> Response:
    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'"
    )
    return response


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next) -> Response:
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    request.state.request_id = request_id
    request.state.source = None
    request.state.route_name = None
    request.state.forward_result = None

    start_time = time.monotonic()
    try:
        response: Response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
    except Exception:
        duration_ms = round((time.monotonic() - start_time) * 1000, 2)
        logger.exception(
            "request_failed",
            extra={
                "request_id": request_id,
                "source": getattr(request.state, "source", None),
                "route": getattr(request.state, "route_name", None),
                "forward_result": getattr(request.state, "forward_result", None),
                "http_status": 500,
                "duration_ms": duration_ms,
            },
        )
        raise

    duration_ms = round((time.monotonic() - start_time) * 1000, 2)
    logger.info(
        "request",
        extra={
            "request_id": request_id,
            "source": getattr(request.state, "source", None),
            "route": getattr(request.state, "route_name", None),
            "forward_result": getattr(request.state, "forward_result", None),
            "http_status": response.status_code,
            "duration_ms": duration_ms,
        },
    )
    return response


@app.get("/")
async def index(_: Optional[str] = Depends(require_basic_auth)) -> Response:
    return FileResponse(TEMPLATE_FILE)


@app.get("/api/config")
async def get_config(
    request: Request,
    _: Optional[str] = Depends(require_basic_auth),
) -> Response:
    rules = get_rules()
    accept = request.headers.get("accept", "")
    if "text/yaml" in accept:
        return PlainTextResponse(yaml.safe_dump(rules.model_dump(), sort_keys=False))
    return JSONResponse(rules.model_dump())


@app.put("/api/config")
async def put_config(
    request: Request,
    _: Optional[str] = Depends(require_basic_auth),
) -> Response:
    raw_body = await _read_body_with_limit(request, MAX_CONFIG_BODY_BYTES)
    if not raw_body:
        raise HTTPException(status_code=400, detail="Config payload required")
    content_type = request.headers.get("content-type", "")
    try:
        if "application/json" in content_type:
            data = json.loads(raw_body.decode("utf-8"))
        else:
            data = yaml.safe_load(raw_body.decode("utf-8"))
        rules = RuleSet.model_validate(data)
    except Exception as exc:
        logger.warning("Invalid config: %s", exc)
        raise HTTPException(status_code=400, detail="Invalid config format") from exc

    try:
        persist_rules(rules)
    except PermissionError as exc:
        CONFIG_RELOAD_TOTAL.labels(result="fail").inc()
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    set_rules(rules)
    invalidate_target_status_cache()
    CONFIG_RELOAD_TOTAL.labels(result="success").inc()
    return JSONResponse({"saved": True})


@app.post("/admin/reload")
async def admin_reload(_: Optional[str] = Depends(require_basic_auth)) -> Response:
    try:
        reload_rules()
        invalidate_target_status_cache()
        CONFIG_RELOAD_TOTAL.labels(result="success").inc()
    except Exception as exc:
        CONFIG_RELOAD_TOTAL.labels(result="fail").inc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return JSONResponse({"reloaded": True})


@app.post("/api/transform/{source}")
async def preview_transform(
    source: str,
    request: Request,
    _: Optional[str] = Depends(require_basic_auth),
) -> Response:
    payload = await _get_request_json(request, max_bytes=MAX_WEBHOOK_BODY_BYTES)
    request.state.source = source
    rules = get_rules()
    route = select_route(rules, source)
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")
    request.state.route_name = route.name
    request.state.forward_result = "preview"

    output = transform_payload(payload, route)
    return JSONResponse(output)


@app.post("/webhook/{source}")
async def webhook(source: str, request: Request) -> Response:
    request_id = request.state.request_id
    request.state.source = source
    increment_daily("incoming")

    rules = get_rules()
    
    # Verify API key if configured
    api_key_name = verify_api_key(request, rules.auth.api_keys if rules.auth else None)
    request.state.api_key_name = api_key_name
    
    route = select_route(rules, source)
    if not route:
        raise HTTPException(status_code=404, detail="Route not found")

    request.state.route_name = route.name

    raw_body = await _read_body_with_limit(request, MAX_WEBHOOK_BODY_BYTES)
    if route.verify_hmac:
        header_value = request.headers.get(route.verify_hmac.header)
        ok, err = verify_hmac_signature(raw_body, header_value, route)
        if not ok:
            HMAC_VERIFY_TOTAL.labels(route=route.name, result="fail").inc()
            raise HTTPException(status_code=401, detail=err or "HMAC verification failed")
        HMAC_VERIFY_TOTAL.labels(route=route.name, result="success").inc()

    try:
        payload = json.loads(raw_body) if raw_body else {}
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}") from exc

    # Alert unrolling: split alerts[] and forward each (OCP Alertmanager)
    outputs_to_forward: list[Any] = []
    if getattr(route, "unroll_alerts", False) and isinstance(payload.get("alerts"), list) and payload["alerts"]:
        for alert in payload["alerts"]:
            sub = copy.deepcopy(payload)
            sub["alerts"] = [alert]
            outputs_to_forward.append(transform_payload(sub, route))
    else:
        outputs_to_forward.append(transform_payload(payload, route))

    start = time.monotonic()
    all_success = True
    last_status_code: Optional[int] = None
    last_error: Optional[Exception] = None
    last_failed_output: Any = None
    forward_enabled = getattr(route, "forward_enabled", True)

    if not forward_enabled:
        duration = time.monotonic() - start
        FORWARD_TOTAL.labels(route=route.name, result="skipped").inc()
        FORWARD_LATENCY_SECONDS.labels(route=route.name).observe(duration)
        request.state.forward_result = "skipped"
        http_status = 200
        REQUESTS_TOTAL.labels(
            source=source,
            route=route.name,
            status=str(http_status),
        ).inc()
        alert_summary = extract_alert_summary(payload)
        err_pause = "Forwarding paused (outbound disabled for this route)"
        if outputs_to_forward:
            preview_src = outputs_to_forward[0]
        else:
            preview_src = transform_payload(payload, route)
        san_preview = sanitize_payload(preview_src)
        RECENT_FAILED.append(
            {
                "ts": datetime.now(BANGKOK).isoformat()[:23],
                "request_id": request_id,
                "source": source,
                "route": route.name,
                "http_status": http_status,
                "payload_preview": json.dumps(san_preview)[:200],
                "error": err_pause,
            }
        )
        if dlq_file_path():
            record_failed_forward(
                {
                    "ts": datetime.now(BANGKOK).isoformat()[:23],
                    "request_id": request_id,
                    "base_request_id": request_id,
                    "unroll_index": 0,
                    "unroll_count": max(1, len(outputs_to_forward)),
                    "source": source,
                    "route": route.name,
                    "http_status": None,
                    "error": err_pause,
                    "error_type": "ForwardPaused",
                    "final_failure": True,
                    "forward_paused": True,
                    "transformed": san_preview,
                }
            )
        increment_daily("forward_fail")
        increment_daily("dlq")
        RECENT_WEBHOOKS.append({
            "ts": datetime.now(BANGKOK).isoformat()[:23],
            "request_id": request_id,
            "source": source,
            "route": route.name,
            "http_status": http_status,
            "forwarded": False,
            "alert_summary": alert_summary or None,
        })
        RECENT_PAYLOADS.append({
            "ts": datetime.now(BANGKOK).isoformat()[:23],
            "source": source,
            "route": route.name,
            "request_id": request_id,
            "payload": sanitize_payload(payload),
        })
        return JSONResponse(
            {
                "status": "ok",
                "request_id": request_id,
                "forwarded": False,
                "forward_paused": True,
            },
            status_code=http_status,
        )

    for i, output in enumerate(outputs_to_forward):
        rid = f"{request_id}-{i}" if len(outputs_to_forward) > 1 else request_id
        ok, status_code, err, attempt_meta = await forward_payload(output, route, rid, rules.defaults)
        if ok:
            increment_daily("forward_success")
            RECENT_SENT.append({
                "ts": datetime.now(BANGKOK).isoformat()[:23],
                "request_id": rid,
                "base_request_id": request_id,
                "source": source,
                "route": route.name,
                "transformed": sanitize_payload(output),
            })
        else:
            all_success = False
            last_status_code = status_code
            last_error = err
            last_failed_output = output
            # One DLQ line per forward outcome after internal retries complete (not per retry attempt).
            # When unroll_alerts splits one webhook into N forwards, N lines share base_request_id;
            # suffix -0/-1 on request_id is the shard index, not HTTP retry.
            n_out = len(outputs_to_forward)
            record_failed_forward(
                {
                    "ts": datetime.now(BANGKOK).isoformat()[:23],
                    "request_id": rid,
                    "base_request_id": request_id,
                    "unroll_index": i,
                    "unroll_count": n_out,
                    "source": source,
                    "route": route.name,
                    "http_status": status_code,
                    "error": str(err) if err else None,
                    "error_type": type(err).__name__ if err else None,
                    "attempts_used": int(attempt_meta.get("attempts_used", 0)),
                    "max_attempts": int(attempt_meta.get("max_attempts", 0)),
                    "is_retry": bool(attempt_meta.get("retried", False)),
                    "retry_count": max(int(attempt_meta.get("attempts_used", 0)) - 1, 0),
                    "circuit_open": bool(attempt_meta.get("circuit_open", False)),
                    "final_failure": True,
                    "transformed": sanitize_payload(output),
                }
            )
    # Daily forward_fail / dlq: one tick per incoming webhook if any outbound failed (not per unrolled alert).
    # DLQ JSONL may still hold one line per failed shard for operations.
    if forward_enabled and not all_success and outputs_to_forward:
        increment_daily("forward_fail")
        increment_daily("dlq")
    success = all_success
    duration = time.monotonic() - start

    FORWARD_LATENCY_SECONDS.labels(route=route.name).observe(duration)
    FORWARD_TOTAL.labels(route=route.name, result="success" if success else "fail").inc()

    request.state.forward_result = "success" if success else "fail"
    http_status = 200 if success else 202
    REQUESTS_TOTAL.labels(
        source=source,
        route=route.name,
        status=str(http_status),
    ).inc()

    if not success:
        failed_output = last_failed_output if last_failed_output is not None else (
            outputs_to_forward[-1] if outputs_to_forward else {}
        )
        logger.error(
            "forward_failed",
            extra={
                "request_id": request_id,
                "source": source,
                "route": route.name,
                "forward_result": "fail",
                "http_status": http_status,
                "duration_ms": round(duration * 1000, 2),
                "error_type": type(last_error).__name__ if last_error else None,
                "error_status": last_status_code,
                "sanitized_payload": sanitize_payload(failed_output),
            },
        )
        RECENT_FAILED.append({
            "ts": datetime.now(BANGKOK).isoformat()[:23],
            "request_id": request_id,
            "source": source,
            "route": route.name,
            "http_status": http_status,
            "payload_preview": json.dumps(sanitize_payload(failed_output))[:200],
            "error": str(last_error) if last_error else None,
        })

    # Append to live feed for UI (newest at end; API returns reversed)
    alert_summary = extract_alert_summary(payload)
    RECENT_WEBHOOKS.append({
        "ts": datetime.now(BANGKOK).isoformat()[:23],
        "request_id": request_id,
        "source": source,
        "route": route.name,
        "http_status": http_status,
        "forwarded": success,
        "alert_summary": alert_summary or None,
    })
    # Store sanitized incoming payload so UI can use as source pattern (real traffic shape)
    RECENT_PAYLOADS.append({
        "ts": datetime.now(BANGKOK).isoformat()[:23],
        "source": source,
        "route": route.name,
        "request_id": request_id,
        "payload": sanitize_payload(payload),
    })

    return JSONResponse(
        {"status": "ok", "request_id": request_id, "forwarded": success},
        status_code=http_status,
    )


@app.get("/healthz")
async def healthz() -> Response:
    return JSONResponse({"ok": True})


@app.get("/version")
async def version() -> Response:
    """Return app version, author, and git commit (for deploy verification)."""
    git_sha = os.getenv("GIT_SHA", "unknown")
    ns = os.getenv("ALERTBRIDGE_K8S_NAMESPACE", "").strip()
    if not ns:
        try:
            with open("/var/run/secrets/kubernetes.io/serviceaccount/namespace", "r", encoding="utf-8") as handle:
                ns = handle.read().strip()
        except OSError:
            ns = ""
    return JSONResponse({
        "version": APP_VERSION,
        "author": "Sontas Jiamsripong",
        "git_sha": git_sha,
        "namespace": ns or None,
    })


@app.get("/readyz")
async def readyz() -> Response:
    rules_ok = rules_loaded()
    client_ready = get_client() is not None
    ready = rules_ok and client_ready
    return JSONResponse(
        {"ready": ready, "rules_loaded": rules_ok, "http_client_ready": client_ready}
    )


@app.get("/api/stats")
async def api_stats() -> Response:
    """Return request/forward counts for UI (no auth so dashboard always shows data)."""
    return JSONResponse(get_request_stats())


@app.get("/api/recent-requests")
async def api_recent_requests() -> Response:
    """Return last N webhook requests (newest first) for UI live feed (no auth)."""
    # Newest first: reverse the deque snapshot
    snapshot = list(RECENT_WEBHOOKS)
    snapshot.reverse()
    return JSONResponse(snapshot)


@app.get("/api/recent-failed")
async def api_recent_failed() -> Response:
    """Return last N failed forward events (limited, stateless). No auth."""
    snapshot = list(RECENT_FAILED)
    snapshot.reverse()
    return JSONResponse(snapshot)


@app.get("/api/recent-sent")
async def api_recent_sent() -> Response:
    """Return last successfully forwarded (transformed) payload for UI verification."""
    snapshot = list(RECENT_SENT)
    return JSONResponse(list(reversed(snapshot))[:1])


@app.get("/api/recent-payloads")
async def api_recent_payloads() -> Response:
    """Return last N incoming payloads (sanitized) so UI can use as source pattern from real traffic (no auth)."""
    snapshot = list(RECENT_PAYLOADS)
    snapshot.reverse()
    return JSONResponse(snapshot)


@app.get("/api/dlq/recent")
async def api_dlq_recent(
    _: Optional[str] = Depends(require_basic_auth),
    limit: int = 50,
) -> Response:
    """Latest rows from the on-disk DLQ (JSONL). Requires Basic Auth."""
    if not dlq_file_path():
        return JSONResponse(
            {"configured": False, "entries": [], "detail": "ALERTBRIDGE_DLQ_FILE not set"},
            status_code=503,
        )
    lim = max(1, min(int(limit), 200))
    entries = read_recent_dlq(limit=lim)
    return JSONResponse({"configured": True, "entries": entries, "count": len(entries)})


@app.post("/api/dlq/purge")
async def api_dlq_purge(
    request: Request,
    _: Optional[str] = Depends(require_basic_auth),
) -> Response:
    """Remove DLQ rows after review. Body: {\"all\": true} or {\"ids\": [...]}. Each id may be dlq_id or request_id. Requires Basic Auth."""
    if not dlq_file_path():
        return JSONResponse(
            {"ok": False, "detail": "ALERTBRIDGE_DLQ_FILE not set"},
            status_code=503,
        )
    body = await _read_json_with_limit(request, max_bytes=262144)
    if body.get("all") is True:
        ok, err = purge_dlq_all()
        if not ok:
            return JSONResponse({"ok": False, "detail": err or "purge failed"}, status_code=500)
        return JSONResponse({"ok": True, "removed": "all"})
    ids = body.get("ids")
    if isinstance(ids, list):
        id_set = {str(x).strip() for x in ids if x}
        if not id_set:
            raise HTTPException(status_code=400, detail="ids must be non-empty")
        removed, err = purge_dlq_by_ids(id_set)
        if err:
            return JSONResponse({"ok": False, "detail": err}, status_code=500)
        return JSONResponse({"ok": True, "removed": removed})
    raise HTTPException(
        status_code=400,
        detail='Expected JSON body: {"all": true} or {"ids": ["..."]}',
    )


@app.get("/api/metrics/daily")
async def api_metrics_daily(
    _: Optional[str] = Depends(require_basic_auth),
    days: int = 30,
) -> Response:
    """Persisted daily counters on PVC (counts only, no event detail)."""
    p = daily_metrics_file_path()
    if not p:
        return JSONResponse(
            {"configured": False, "entries": [], "detail": "DLQ path not configured"},
            status_code=503,
        )
    lim = max(1, min(int(days), 365))
    return JSONResponse({"configured": True, "entries": read_daily(lim)})


def _internal_webhook_base() -> str:
    """
    Base URL for in-cluster callers, e.g. http://alertbridge-lite.alertbridge.svc.cluster.local
    Override with ALERTBRIDGE_INTERNAL_WEBHOOK_BASE. If unset, build from
    ALERTBRIDGE_K8S_SERVICE_NAME (default alertbridge-lite) + ALERTBRIDGE_K8S_NAMESPACE when set.
    """
    explicit = os.getenv("ALERTBRIDGE_INTERNAL_WEBHOOK_BASE", "").strip().rstrip("/")
    if explicit:
        return explicit
    ns = os.getenv("ALERTBRIDGE_K8S_NAMESPACE", "").strip()
    if not ns:
        return ""
    svc = os.getenv("ALERTBRIDGE_K8S_SERVICE_NAME", "alertbridge-lite").strip() or "alertbridge-lite"
    return f"http://{svc}.{ns}.svc.cluster.local"


@app.get("/api/in-cluster-webhook-base")
async def api_in_cluster_webhook_base() -> Response:
    """In-cluster webhook base (HTTP Service DNS) for UI copy-paste. No auth."""
    base = _internal_webhook_base()
    return JSONResponse({"internal_webhook_base": base or None})


@app.get("/api/config/targets")
async def api_config_targets() -> Response:
    """Return effective target URL per route (what forward uses). No auth."""
    rules = get_rules()
    out = []
    for r in rules.routes:
        url = (r.target.url or "").strip() or os.getenv(r.target.url_env) or None
        out.append({"route": r.name, "source": r.match.source, "target_url": url or "(not set)"})
    return JSONResponse(out)


def _paused_route_status(route) -> Dict[str, Any]:
    """Status row when forwarding is paused (no outbound probe)."""
    url = (route.target.url or "").strip() or os.getenv(route.target.url_env) or None
    return {
        "route": route.name,
        "target_url": url or "(not set)",
        "phase1_ok": True,
        "phase2_ok": True,
        "error": None,
        "forward_paused": True,
    }


async def _compute_target_status() -> Dict[str, Any]:
    """Two-phase check per route; same shape as /api/target-status response."""
    rules = get_rules()
    defaults = rules.defaults if rules.defaults is not None else Defaults()
    out: List[Dict[str, Any]] = []
    probe_routes: List[Any] = []
    probe_indices: List[int] = []

    for route in rules.routes:
        if not getattr(route, "forward_enabled", True):
            out.append(_paused_route_status(route))
        else:
            probe_indices.append(len(out))
            out.append({})  # placeholder
            probe_routes.append(route)

    results = await asyncio.gather(
        *[check_target_status(r, defaults) for r in probe_routes],
        return_exceptions=True,
    )
    for j, idx in enumerate(probe_indices):
        r = results[j]
        if isinstance(r, Exception):
            rn = probe_routes[j].name if j < len(probe_routes) else "?"
            out[idx] = {"route": rn, "phase1_ok": False, "phase2_ok": False, "error": str(r)}
        else:
            out[idx] = r

    configured = [x for x in out if x.get("target_url") and x.get("target_url") != "(not set)"]
    has_any_target = len(configured) > 0
    active = [x for x in configured if not x.get("forward_paused")]
    all_ok = len(active) > 0 and all(x.get("phase1_ok") and x.get("phase2_ok") for x in active)
    return {"routes": out, "has_any_target": has_any_target, "all_ok": all_ok}


_TARGET_STATUS_LOCK = asyncio.Lock()
_TARGET_STATUS_CACHE: Optional[Dict[str, Any]] = None
_TARGET_STATUS_CACHE_MONO: float = 0.0
TARGET_STATUS_CACHE_TTL_SEC = float(os.getenv("ALERTBRIDGE_TARGET_STATUS_CACHE_SEC", "12"))


def invalidate_target_status_cache() -> None:
    """Drop cached target probes (e.g. after admin reload)."""
    global _TARGET_STATUS_CACHE, _TARGET_STATUS_CACHE_MONO
    _TARGET_STATUS_CACHE = None
    _TARGET_STATUS_CACHE_MONO = 0.0


async def _get_target_status_snapshot() -> Dict[str, Any]:
    """
    Cached outbound target probes for portal badges. Without this, every /api/portal-status poll
    runs GET+POST to each forward target (slow if targets are far away or down).
    """
    global _TARGET_STATUS_CACHE, _TARGET_STATUS_CACHE_MONO
    now = time.monotonic()
    if _TARGET_STATUS_CACHE is not None and (now - _TARGET_STATUS_CACHE_MONO) < TARGET_STATUS_CACHE_TTL_SEC:
        return _TARGET_STATUS_CACHE
    async with _TARGET_STATUS_LOCK:
        now = time.monotonic()
        if _TARGET_STATUS_CACHE is not None and (now - _TARGET_STATUS_CACHE_MONO) < TARGET_STATUS_CACHE_TTL_SEC:
            return _TARGET_STATUS_CACHE
        snap = await _compute_target_status()
        _TARGET_STATUS_CACHE = snap
        _TARGET_STATUS_CACHE_MONO = time.monotonic()
        return snap


@app.get("/api/target-status")
async def api_target_status() -> Response:
    """Two-phase check: Phase1 server reachable, Phase2 API handshake OK. No auth."""
    try:
        return JSONResponse(await _get_target_status_snapshot())
    except Exception as exc:
        logger.exception("target_status_failed")
        return JSONResponse(
            {"routes": [], "has_any_target": False, "all_ok": False, "error": str(exc)},
            status_code=200,
        )


def _portal_dlq_badge() -> Dict[str, Any]:
    p = dlq_file_path()
    if not p:
        return {"state": "disabled", "detail": "not configured"}
    try:
        if os.path.isfile(p):
            sz = os.path.getsize(p)
            if sz >= 1024 * 1024:
                detail = f"{sz // (1024 * 1024)} MiB"
            elif sz >= 1024:
                detail = f"{sz // 1024} KiB"
            else:
                detail = "empty" if sz == 0 else f"{sz} B"
            return {"state": "ok", "detail": detail}
        return {"state": "partial", "detail": "awaits first failure"}
    except OSError as exc:
        return {"state": "down", "detail": str(exc)[:120]}


@app.get("/api/portal-status")
async def api_portal_status() -> Response:
    """Aggregated header badges: incoming (receive), forward (targets), DLQ file. No auth."""
    rules = get_rules()
    rl = rules_loaded()
    n_routes = len(rules.routes) if rules else 0
    if not rl:
        incoming = {"state": "down", "detail": "starting"}
    elif n_routes == 0:
        incoming = {"state": "partial", "detail": "no routes"}
    else:
        incoming = {"state": "ok", "detail": f"{n_routes} route(s)"}

    try:
        ts = await _get_target_status_snapshot()
        routes_out = ts["routes"]
        has_any = ts["has_any_target"]
        all_ok = ts["all_ok"]
        configured = [x for x in routes_out if x.get("target_url") and x.get("target_url") != "(not set)"]
        active_cf = [x for x in configured if not x.get("forward_paused")]
        paused_n = len(configured) - len(active_cf)
        ok_cnt = sum(1 for x in active_cf if x.get("phase1_ok") and x.get("phase2_ok"))
        tot_active = len(active_cf)
        tot = len(configured)
        if not has_any:
            forward = {"state": "disabled", "detail": "no targets", "ok_count": 0, "total": 0}
        elif tot and paused_n == tot:
            forward = {
                "state": "partial",
                "detail": f"{paused_n} forwarding paused",
                "ok_count": 0,
                "total": tot,
            }
        elif all_ok and tot_active:
            detail = f"{ok_cnt}/{tot_active} OK"
            if paused_n:
                detail += f" · {paused_n} paused"
            forward = {"state": "ok", "detail": detail, "ok_count": ok_cnt, "total": tot_active}
        elif ok_cnt > 0:
            detail = f"{ok_cnt}/{tot_active} OK" if tot_active else f"{ok_cnt} OK"
            if paused_n:
                detail += f" · {paused_n} paused"
            forward = {"state": "partial", "detail": detail, "ok_count": ok_cnt, "total": tot_active or tot}
        else:
            detail = f"{ok_cnt}/{tot_active} OK" if tot_active else "0 OK"
            if paused_n:
                detail += f" · {paused_n} paused"
            forward = {"state": "down", "detail": detail, "ok_count": ok_cnt, "total": tot_active or tot}
    except Exception as exc:
        logger.warning("portal_status_forward: %s", exc)
        routes_out = []
        has_any = False
        all_ok = False
        forward = {"state": "down", "detail": str(exc), "ok_count": 0, "total": 0}

    dlq = _portal_dlq_badge()

    return JSONResponse(
        {
            "incoming": incoming,
            "forward": forward,
            "dlq": dlq,
            "routes": routes_out,
            "has_any_target": has_any,
            "all_ok": all_ok,
        }
    )


# ---------- Field mapper / patterns (optional Basic Auth) ----------

@app.get("/api/pattern-schemas")
async def api_pattern_schemas(_: Optional[str] = Depends(require_basic_auth)) -> Response:
    """Return built-in source schemas (OCP 4.20, Confluent 8.10) and target fields for the mapper UI."""
    return JSONResponse(list_schemas())


@app.get("/api/patterns")
async def api_list_patterns(_: Optional[str] = Depends(require_basic_auth)) -> Response:
    """List all saved field-mapping patterns."""
    return JSONResponse(list_patterns())


@app.get("/api/patterns/{pattern_id}")
async def api_get_pattern(
    pattern_id: str,
    _: Optional[str] = Depends(require_basic_auth),
) -> Response:
    """Get one saved pattern by id."""
    pattern = get_pattern(pattern_id)
    if not pattern:
        raise HTTPException(status_code=404, detail="Pattern not found")
    return JSONResponse(pattern)


@app.post("/api/patterns")
async def api_save_pattern(
    request: Request,
    _: Optional[str] = Depends(require_basic_auth),
) -> Response:
    """Save a pattern. Body: { name, source_type, mappings[, id] }."""
    body = await _read_json_with_limit(request)
    name = (body.get("name") or "Unnamed pattern").strip()[:200]
    source_type = (body.get("source_type") or "").strip()[:100]
    mappings = body.get("mappings") or []
    if len(mappings) > 500:
        raise HTTPException(status_code=400, detail="Too many mappings")
    pattern_id = body.get("id")
    old = copy.deepcopy(get_pattern(pattern_id)) if pattern_id else None
    try:
        saved = save_pattern_data(name=name, source_type=source_type, mappings=mappings, pattern_id=pattern_id)
    except Exception as exc:
        logger.warning("Pattern save failed: %s", exc)
        raise HTTPException(status_code=400, detail="Invalid pattern") from exc
    try:
        persist_rules(get_rules())
    except PermissionError as exc:
        if old:
            save_pattern_data(
                name=old["name"],
                source_type=old["source_type"],
                mappings=old["mappings"],
                pattern_id=old["id"],
            )
        else:
            delete_pattern_data(saved["id"])
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return JSONResponse(saved)


@app.delete("/api/patterns/{pattern_id}")
async def api_delete_pattern(
    pattern_id: str,
    _: Optional[str] = Depends(require_basic_auth),
) -> Response:
    """Delete a saved pattern."""
    old = copy.deepcopy(get_pattern(pattern_id))
    if not old:
        raise HTTPException(status_code=404, detail="Pattern not found")
    delete_pattern_data(pattern_id)
    try:
        persist_rules(get_rules())
    except PermissionError as exc:
        save_pattern_data(
            name=old["name"],
            source_type=old["source_type"],
            mappings=old["mappings"],
            pattern_id=old["id"],
        )
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return JSONResponse({"deleted": True})


@app.post("/api/patterns/apply")
async def api_apply_pattern(
    request: Request,
    _: Optional[str] = Depends(require_basic_auth),
) -> Response:
    """
    Apply a pattern to a route. Body: { route_name, pattern_id? } or { route_name, source_type, mappings[, pattern_name] }.
    When applying from form (mappings), optional pattern_name will save the pattern so it appears in Saved Patterns.
    Updates the route's transform and saves config if writable.
    """
    try:
        body = await _read_json_with_limit(request)
    except Exception as e:
        return JSONResponse({"detail": str(e)}, status_code=400)

    route_name = body.get("route_name")
    if not route_name:
        return JSONResponse({"detail": "route_name required"}, status_code=400)

    rules = get_rules()
    route = next((r for r in rules.routes if r.name == route_name), None)
    if not route:
        return JSONResponse({"detail": "Route not found"}, status_code=404)

    pattern_id = body.get("pattern_id")
    source_type = body.get("source_type") or ""
    saved_pattern: Optional[dict] = None
    if pattern_id:
        pattern = get_pattern(pattern_id)
        if not pattern:
            return JSONResponse({"detail": "Pattern not found"}, status_code=404)
        mappings = pattern["mappings"]
    else:
        mappings = body.get("mappings") or []
        if not mappings:
            return JSONResponse({"detail": "Provide pattern_id or mappings"}, status_code=400)
        if len(mappings) > 500:
            return JSONResponse({"detail": "Too many mappings"}, status_code=400)
        # Auto-save pattern when applying from form, so it appears in Saved Patterns
        pattern_name = (body.get("pattern_name") or "").strip() or f"Applied to {route_name}"
        saved_pattern = save_pattern_data(name=pattern_name, source_type=source_type, mappings=mappings)

    try:
        new_transform = build_transform_from_mapping(mappings)
        active_id: Optional[str] = None
        active_nm: Optional[str] = None
        if pattern_id:
            pmeta = get_pattern(pattern_id)
            if pmeta:
                active_id = pattern_id
                active_nm = pmeta.get("name")
        elif saved_pattern:
            active_id = saved_pattern.get("id")
            active_nm = saved_pattern.get("name")
        new_route = route.model_copy(
            update={
                "transform": new_transform,
                "active_pattern_id": active_id,
                "active_pattern_name": active_nm,
            }
        )
        updated_routes = [new_route if r.name == route_name else r for r in rules.routes]
        new_rules = rules.model_copy(update={"routes": updated_routes})
        try:
            persist_rules(new_rules)
        except PermissionError as exc:
            CONFIG_RELOAD_TOTAL.labels(result="fail").inc()
            if saved_pattern:
                delete_pattern_data(saved_pattern["id"])
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        set_rules(new_rules)
        CONFIG_RELOAD_TOTAL.labels(result="success").inc()

        out = {"applied": True, "route_name": route_name}
        if saved_pattern:
            out["pattern_saved"] = saved_pattern.get("name", "")
        return JSONResponse(out)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("patterns_apply_failed")
        return JSONResponse({"detail": str(e)}, status_code=500)


@app.get("/metrics")
async def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


# ---------- API Key Management (requires Basic Auth) ----------

@app.get("/api/api-keys")
async def api_list_api_keys(_: Optional[str] = Depends(require_basic_auth)) -> Response:
    """List all API keys (without exposing full key values)."""
    return JSONResponse(get_api_keys())


@app.post("/api/api-keys")
async def api_create_api_key(
    request: Request,
    _: Optional[str] = Depends(require_basic_auth),
) -> Response:
    """Create a new API key. Body: { name: string }."""
    body = await _read_json_with_limit(request)
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    if len(name) > 128:
        raise HTTPException(status_code=400, detail="name too long")
    if any(c in name for c in "\x00\r\n\t"):
        raise HTTPException(status_code=400, detail="name contains invalid characters")
    
    new_key = create_api_key(name)
    
    # Add to config
    rules = get_rules()
    if not rules.auth:
        from app.rules import AuthConfig
        rules.auth = AuthConfig()
    
    if not rules.auth.api_keys:
        rules.auth.api_keys = ApiKeyConfig(keys=[], required=True)
    
    rules.auth.api_keys.keys.append(new_key)

    try:
        persist_rules(rules)
    except PermissionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    
    set_rules(rules)
    
    return JSONResponse({
        "name": new_key.name,
        "key": new_key.key,  # Return full key only on creation
        "created_at": new_key.created_at,
    })


@app.delete("/api/api-keys/{name}")
async def api_delete_api_key(
    name: str,
    _: Optional[str] = Depends(require_basic_auth),
) -> Response:
    """Delete an API key by name."""
    rules = get_rules()
    if not rules.auth or not rules.auth.api_keys:
        raise HTTPException(status_code=404, detail="API key not found")
    
    # Find and remove the key
    original_count = len(rules.auth.api_keys.keys)
    rules.auth.api_keys.keys = [k for k in rules.auth.api_keys.keys if k.name != name]
    
    if len(rules.auth.api_keys.keys) == original_count:
        raise HTTPException(status_code=404, detail="API key not found")

    try:
        persist_rules(rules)
    except PermissionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    
    set_rules(rules)
    return JSONResponse({"deleted": True, "name": name})


@app.put("/api/api-keys/config")
async def api_update_api_key_config(
    request: Request,
    _: Optional[str] = Depends(require_basic_auth),
) -> Response:
    """Update API key config. Body: { required: boolean }."""
    body = await _read_json_with_limit(request)
    required = body.get("required", True)
    
    rules = get_rules()
    if not rules.auth:
        from app.rules import AuthConfig
        rules.auth = AuthConfig()
    
    if not rules.auth.api_keys:
        rules.auth.api_keys = ApiKeyConfig(keys=[], required=required)
    else:
        rules.auth.api_keys.required = required

    try:
        persist_rules(rules)
    except PermissionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    
    set_rules(rules)
    return JSONResponse({"required": required})


async def _read_body_with_limit(request: Request, max_bytes: int) -> bytes:
    """Read request body with size limit (DoS mitigation). Raises 413 if exceeded."""
    body = b""
    async for chunk in request.stream():
        body += chunk
        if len(body) > max_bytes:
            raise HTTPException(status_code=413, detail="Request body too large")
    return body


async def _read_json_with_limit(request: Request, max_bytes: int = MAX_CONFIG_BODY_BYTES) -> Any:
    """Read JSON body with size limit (DoS mitigation for admin endpoints)."""
    raw = await _read_body_with_limit(request, max_bytes)
    if not raw:
        return {}
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        logger.warning("Invalid JSON body: %s", exc)
        raise HTTPException(status_code=400, detail="Invalid JSON") from exc


async def _get_request_json(request: Request, max_bytes: int = MAX_WEBHOOK_BODY_BYTES) -> Any:
    try:
        body = await _read_body_with_limit(request, max_bytes)
        return json.loads(body) if body else {}
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Invalid webhook JSON: %s", exc)
        raise HTTPException(status_code=400, detail="Invalid JSON") from exc
