# Features & Functions Reference

> AlertBridge features. Author: Sontas Jiamsripong · Version: 1.0.07022026

---

## 1. API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/` | Basic | Serve UI (index.html) |
| GET | `/api/config` | Basic | Get rules (JSON or YAML via Accept) |
| PUT | `/api/config` | Basic | Save rules (JSON or YAML body) |
| POST | `/admin/reload` | Basic | Reload rules from file/ConfigMap |
| POST | `/webhook/{source}` | API Key + HMAC | Receive webhook, transform, forward |
| POST | `/api/transform/{source}` | Basic | Preview transform only |
| GET | `/api/stats` | None | Request/forward counts (Prometheus) |
| GET | `/api/recent-requests` | None | Last 20 webhooks (Live Events) |
| GET | `/api/recent-failed` | None | Last 200 failed forwards |
| GET | `/api/recent-payloads` | None | Last 30 payloads (Field Mapper) |
| GET | `/api/config/targets` | None | Effective target URL per route |
| GET | `/api/target-status` | None | Phase1+2 target reachability |
| GET | `/api/pattern-schemas` | Basic | Source/target schemas for mapper |
| GET/POST/DELETE | `/api/patterns` | Basic | List/save/delete patterns |
| GET | `/api/patterns/{id}` | Basic | Get one pattern |
| POST | `/api/patterns/apply` | Basic | Apply pattern to route |
| GET/POST/DELETE | `/api/api-keys` | Basic | API key management |
| PUT | `/api/api-keys/config` | Basic | Set required flag |
| GET | `/healthz` | None | Liveness |
| GET | `/readyz` | None | Readiness (rules + client) |
| GET | `/metrics` | None | Prometheus metrics |

---

## 2. UI Sections (index.html + app.js)

| Section | Data Source | Refresh |
|---------|-------------|---------|
| Realtime metrics | /api/stats | 1s |
| Request count | /api/stats | 1s |
| Portal status | /api/stats | 1s |
| Target Fwd status | /api/target-status | 5s |
| Live Events | /api/recent-requests | 1.5s |
| Failed Events | /api/recent-failed | 1.5s |
| Webhook Endpoints | config.routes | on load |
| Target URLs & API Keys | /api/config/targets | 3s |
| Field Mapper | /api/pattern-schemas, /api/patterns, /api/recent-payloads | on action |
| Config YAML | /api/config | on load/save |
| Test/Preview | /api/transform/{source} | on click |
| API Keys list | /api/api-keys | on action |

---

## 3. Feature Detail

### 3.1 Live Events
- **Storage:** RECENT_WEBHOOKS (maxlen=20)
- **Fields:** ts, request_id, source, route, http_status, forwarded, alert_summary
- **alert_summary:** Extracted from OCP (labels.alertname, annotations.summary) or Confluent (description, alertId)
- **Backend:** `main.py` extract_alert_summary(), RECENT_WEBHOOKS.append()
- **API:** GET /api/recent-requests

### 3.2 Failed Events
- **Storage:** RECENT_FAILED (maxlen=200)
- **Display:** 20, client-side search
- **Fields:** ts, request_id, source, route, http_status, payload_preview, error
- **Backend:** main.py RECENT_FAILED.append() on forward fail
- **API:** GET /api/recent-failed

### 3.3 Target Forward Status
- **Phase1:** GET base URL (server reachable)
- **Phase2:** POST {} with auth (API handshake OK)
- **Backend:** forwarder.py check_target_status()
- **API:** GET /api/target-status
- **UI:** Header "Target Fwd: Online/Offline" or "1/2 OK"; per-target badge in "Server will forward to"

### 3.4 Field Mapper
- **Source schemas:** OCP Alertmanager 4.20, Confluent 8.10 (patterns.py SOURCE_SCHEMAS)
- **Target fields:** severity, title, message, env, site, source_id, timestamp
- **Patterns:** In-memory (_saved_patterns), build_transform_from_mapping → TransformConfig
- **Apply:** PATCH route.transform via persist_rules

### 3.5 Alert Unrolling
- **Config:** `unroll_alerts: true` per route (RouteConfig)
- **Behavior:** When payload has `alerts[]`, split and forward each alert separately (OCP Alertmanager)
- **Backend:** main.py webhook handler

### 3.6 Transform Pipeline (rules.py)
- **Order:** include_fields → drop_fields → rename → enrich_static → map_values → output_template
- **JSONPath:** Selector `$.field` for output_template

### 3.7 Circuit Breaker & Retry
- **Circuit breaker:** After 5 consecutive failures, open circuit (stop sending) for 60s; then half-open
- **Retry:** Exponential backoff 0, 1, 2, 4 seconds on 5xx / ConnectTimeout
- **Backend:** forwarder.py _circuit_allow, _circuit_record, BACKOFF_SCHEDULE

### 3.8 Config Auto-Reload
- **Config:** ALERTBRIDGE_CONFIG_WATCH_INTERVAL (default 30s; 0=disabled)
- **Behavior:** Background task polls rules file mtime; reload when changed (ConfigMap mount)
- **Backend:** config.py watch_and_reload, main.py _config_watch_loop

### 3.9 Config Persistence
- **File:** RULES_PATH (ALERTBRIDGE_RULES_PATH)
- **ConfigMap:** When ALERTBRIDGE_CONFIGMAP_NAME set, k8s_configmap.patch_configmap_rules()

---

## 4. Key Functions by File

| File | Functions |
|------|-----------|
| main.py | extract_alert_summary, _read_body_with_limit, _get_request_json |
| config.py | get_rules, set_rules, reload_rules, persist_rules, load_rules_from_file |
| rules.py | select_route, transform_payload, sanitize_payload |
| forwarder.py | forward_payload, check_target_status, _is_safe_forward_url |
| patterns.py | list_schemas, list_patterns, save_pattern, build_transform_from_mapping |
| api_key.py | verify_api_key, create_api_key, get_api_keys |
| basic_auth.py | require_basic_auth, _get_local_users |
| hmac_verify.py | verify_hmac |

---

## 5. i18n (app/static/i18n.js)

- Keys in LANG.en / LANG.th
- applyI18n() on [data-i18n]
- tr(key) / window.t(key) for JS
- Language stored in localStorage alertbridge_lang

---

## 6. Tests (tests/)

- test_basic_auth.py: parse header, users from env/config
- test_forwarder.py: safe URL scheme
- test_hmac_verify.py: HMAC verify
- test_rules.py: include/drop/rename/enrich/map

---

## 7. Common Extension Points

| Task | Where to Change |
|------|-----------------|
| Add new source schema | patterns.py SOURCE_SCHEMAS |
| Add transform step | rules.py transform_payload |
| Add API endpoint | main.py @app.get/post |
| Add UI section | index.html + app.js |
| Change body limit | main.py MAX_*_BYTES |
| Add env var | Use os.getenv in relevant module |
