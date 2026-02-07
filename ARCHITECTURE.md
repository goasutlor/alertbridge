# Architecture Context

> AlertBridge architecture. Author: Sontas Jiamsripong · Version: 1.0.07022026

## 1. High-Level Overview

```
┌─────────────────┐     POST /webhook/{source}      ┌──────────────────────┐
│  OCP Alertmgr   │ ─────────────────────────────► │                      │
│  Confluent      │     (API Key / HMAC optional)         │   alertbridge-lite   │
│  Other clients  │                                 │   (FastAPI)          │
└─────────────────┘                                 │                      │
                                                    │  Transform ────────► │  Target
                                                    │  (YAML rules)        │  (HTTPS)
                                                    └──────────────────────┘
                                                              │
                                                              ▼
                                                    ┌──────────────────────┐
                                                    │  Config UI / Metrics │
                                                    │  (Browser, Prometheus)│
                                                    └──────────────────────┘
```

**Purpose:** Stateless webhook relay that receives JSON alerts from multiple sources (OCP Alertmanager, Confluent, etc.), transforms them via YAML rules, and forwards to HTTPS targets.

---

## 2. Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | FastAPI |
| Server | Uvicorn |
| HTTP client (forward) | httpx (async) |
| Config | PyYAML (safe_load) |
| Validation | Pydantic |
| Metrics | Prometheus client |
| Persistence | File or K8s ConfigMap |

---

## 3. Directory Structure

```
alertbridge-lite/
├── app/
│   ├── main.py          # FastAPI app, routes, middleware
│   ├── config.py        # Rules load/save (file or ConfigMap)
│   ├── rules.py         # RuleSet, TransformConfig, transform_payload, sanitize_payload
│   ├── forwarder.py     # forward_payload, check_target_status
│   ├── basic_auth.py    # require_basic_auth dependency
│   ├── api_key.py       # verify_api_key, create_api_key, get_api_keys
│   ├── hmac_verify.py   # HMAC signature verification per route
│   ├── patterns.py      # Field mapper schemas, saved patterns (in-memory)
│   ├── metrics.py       # Prometheus counters
│   ├── logging_conf.py  # JSON logging
│   ├── k8s_configmap.py # ConfigMap patch for OCP
│   ├── static/          # app.js, i18n.js, styles.css
│   └── templates/       # index.html
├── deploy/              # OCP install, k8s manifests
├── scripts/             # mock_receiver, load_test_webhook
├── tests/
├── rules.example.yaml   # Example config
├── Dockerfile
├── requirements.txt
└── docs (README, SECURITY, VA_TEST, ARCHITECTURE, FEATURES)
```

---

## 4. Core Data Flow

### 4.1 Webhook Flow (POST /webhook/{source})

1. **Request** → middleware assigns `request_id`
2. **API Key** → `verify_api_key()` (if auth.api_keys configured)
3. **Route select** → `select_route(rules, source)` by `match.source`
4. **HMAC** → `verify_hmac()` (if route.verify_hmac configured)
5. **Body** → `_read_body_with_limit(MAX_WEBHOOK_BODY_BYTES)` → JSON parse
6. **Transform** → `transform_payload(payload, route)` (include/drop/rename/enrich/map)
7. **Forward** → `forward_payload(output, route)` via httpx POST
8. **Store** → RECENT_WEBHOOKS, RECENT_PAYLOADS; RECENT_FAILED if forward failed
9. **Response** → 200 (success) or 202 (accept but forward failed)

### 4.2 Config Flow

- **Load:** `get_rules()` → file or ConfigMap (via `ALERTBRIDGE_CONFIGMAP_NAME`)
- **Save:** `persist_rules()` → tries ConfigMap first, then file
- **Reload:** `reload_rules()` → reload from source, update `_rules_cache`

---

## 5. In-Memory State (Stateless Caveats)

| Store | Max | Purpose |
|-------|-----|---------|
| RECENT_WEBHOOKS | 20 | Live Events UI |
| RECENT_PAYLOADS | 30 | Field Mapper "Use as source" |
| RECENT_FAILED | 200 | Failed Events (search, display 20) |
| _rules_cache | 1 | Current RuleSet |
| _saved_patterns | ∞ | Field Mapper patterns (in patterns.py) |

**Lost on restart:** All deques and _saved_patterns. Rules persist via file/ConfigMap.

---

## 6. Auth Model

| Endpoint | Auth |
|----------|------|
| `/`, `/api/config`, `/admin/reload`, `/api/transform/*` | Basic Auth (optional) |
| `/api/patterns/*`, `/api/api-keys/*` | Basic Auth |
| `/webhook/{source}` | API Key (X-API-Key or Bearer) + optional HMAC per route |
| `/healthz`, `/readyz`, `/metrics`, `/api/stats`, `/api/recent-*`, `/api/config/targets`, `/api/target-status` | No auth |

---

## 7. Key Modules

| Module | Responsibility |
|--------|----------------|
| **main.py** | Routes, middleware, body limits, extract_alert_summary |
| **config.py** | Rules load/save, RLock for cache |
| **rules.py** | RuleSet schema, select_route, transform_payload, sanitize_payload |
| **forwarder.py** | httpx client, forward_payload, check_target_status (Phase1+2) |
| **patterns.py** | SOURCE_SCHEMAS (OCP, Confluent), TARGET_FIELDS, build_transform_from_mapping |
| **k8s_configmap.py** | Patch ConfigMap when ALERTBRIDGE_CONFIGMAP_NAME set |

---

## 8. Environment Variables

| Variable | Purpose |
|----------|---------|
| ALERTBRIDGE_RULES_PATH | Rules file path (default /etc/alertbridge/rules.yaml) |
| ALERTBRIDGE_CONFIGMAP_NAME | ConfigMap name for persist (OCP) |
| ALERTBRIDGE_CONFIG_WATCH_INTERVAL | Poll interval (sec) for auto-reload; 0=disabled (default 30) |
| ALERTBRIDGE_NAMESPACE | K8s namespace (default alertbridge) |
| BASIC_AUTH_USER / BASIC_AUTH_PASSWORD | Single-user Basic Auth |
| TARGET_URL_* | Target URL per route (from target.url_env) |

---

## 9. Deployment

- **Local:** `uvicorn app.main:app --host 0.0.0.0 --port 8080`
- **Docker:** Build from Dockerfile, expose 8080
- **OpenShift:** `deploy/install-ocp.yaml` (BuildConfig, Route, ConfigMap, Secret, RBAC)
